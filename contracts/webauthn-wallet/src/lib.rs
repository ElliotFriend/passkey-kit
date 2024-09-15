#![no_std]

use soroban_sdk::{
    auth::{Context, ContractContext, CustomAccountInterface},
    contract, contractimpl,
    crypto::Hash,
    panic_with_error, symbol_short, vec, Bytes, BytesN, Env, FromVal, IntoVal, Map, Symbol, Vec,
};
use types::{Error, Secp256r1Signature, Signature, Signer, SignerKey, SignerStorage, SignerVal};

mod base64_url;
pub mod types;

mod test;

#[contract]
pub struct Contract;

const WEEK_OF_LEDGERS: u32 = 60 * 60 * 24 / 5 * 7;
const EVENT_TAG: Symbol = symbol_short!("sw_v1");
const SIGNER_COUNT: Symbol = symbol_short!("signers");

#[contractimpl]
impl Contract {
    pub fn add(env: Env, signer: Signer) -> Result<(), Error> {
        if env.storage().instance().has(&SIGNER_COUNT) {
            env.current_contract_address().require_auth();
        }

        let max_ttl = env.storage().max_ttl();

        let (signer_key, signer_val, signer_storage) = match signer {
            Signer::Policy(policy, signer_limits, signer_storage) => (
                SignerKey::Policy(policy),
                SignerVal::Policy(signer_limits),
                signer_storage,
            ),
            Signer::Ed25519(public_key, signer_limits, signer_storage) => (
                SignerKey::Ed25519(public_key),
                SignerVal::Ed25519(signer_limits),
                signer_storage,
            ),
            Signer::Secp256r1(id, public_key, signer_limits, signer_storage) => (
                SignerKey::Secp256r1(id),
                SignerVal::Secp256r1(public_key, signer_limits),
                signer_storage,
            ),
        };

        store_signer(&env, &signer_key, &signer_val, &signer_storage);

        env.storage()
            .instance()
            .extend_ttl(max_ttl - WEEK_OF_LEDGERS, max_ttl);

        env.events()
            .publish((EVENT_TAG, symbol_short!("add"), signer_key), signer_val);

        Ok(())
    }
    pub fn remove(env: Env, signer_key: SignerKey) -> Result<(), Error> {
        env.current_contract_address().require_auth();

        if let Some((_, signer_storage)) = get_signer_val_storage(&env, &signer_key, false) {
            update_signer_count(&env, false);

            match signer_storage {
                SignerStorage::Persistent => {
                    env.storage().persistent().remove::<SignerKey>(&signer_key);
                }
                SignerStorage::Temporary => {
                    env.storage().temporary().remove::<SignerKey>(&signer_key);
                }
            }
        }

        let max_ttl = env.storage().max_ttl();

        env.storage()
            .instance()
            .extend_ttl(max_ttl - WEEK_OF_LEDGERS, max_ttl);

        env.events()
            .publish((EVENT_TAG, symbol_short!("remove"), signer_key), ());

        Ok(())
    }
    pub fn update(env: Env, hash: BytesN<32>) -> Result<(), Error> {
        env.current_contract_address().require_auth();

        env.deployer().update_current_contract_wasm(hash);

        let max_ttl = env.storage().max_ttl();

        env.storage()
            .instance()
            .extend_ttl(max_ttl - WEEK_OF_LEDGERS, max_ttl);

        Ok(())
    }
}

fn store_signer(
    env: &Env,
    signer_key: &SignerKey,
    signer_val: &SignerVal,
    signer_storage: &SignerStorage,
) {
    let max_ttl = env.storage().max_ttl();

    // Include this before the `.set` calls so it doesn't read them as previous values
    let previous_signer_val_and_storage: Option<(SignerVal, SignerStorage)> =
        get_signer_val_storage(env, signer_key, false);

    // Add and extend the signer key in the appropriate storage
    let is_persistent = match signer_storage {
        SignerStorage::Persistent => {
            env.storage()
                .persistent()
                .set::<SignerKey, SignerVal>(signer_key, signer_val);
            env.storage().persistent().extend_ttl::<SignerKey>(
                signer_key,
                max_ttl - WEEK_OF_LEDGERS,
                max_ttl,
            );

            true
        }
        SignerStorage::Temporary => {
            env.storage()
                .temporary()
                .set::<SignerKey, SignerVal>(signer_key, signer_val);
            env.storage().temporary().extend_ttl::<SignerKey>(
                signer_key,
                max_ttl - WEEK_OF_LEDGERS,
                max_ttl,
            );

            false
        }
    };

    if let Some((_, previous_signer_storage)) = previous_signer_val_and_storage {
        // Remove signer key in the opposing storage if it exists
        match previous_signer_storage {
            SignerStorage::Persistent => {
                if !is_persistent {
                    env.storage().persistent().remove::<SignerKey>(signer_key);
                }
            }
            SignerStorage::Temporary => {
                if is_persistent {
                    env.storage().temporary().remove::<SignerKey>(signer_key);
                }
            }
        }
    } else {
        // only need to update the signer count here if we're actually adding vs replacing a signer
        update_signer_count(&env, true);
    }
}

fn update_signer_count(env: &Env, add: bool) {
    let count = env
        .storage()
        .instance()
        .get::<Symbol, i32>(&SIGNER_COUNT)
        .unwrap_or(0)
        + if add { 1 } else { -1 };

    env.storage()
        .instance()
        .set::<Symbol, i32>(&SIGNER_COUNT, &count);
}

#[derive(serde::Deserialize)]
struct ClientDataJson<'a> {
    challenge: &'a str,
}

#[contractimpl]
impl CustomAccountInterface for Contract {
    type Error = Error;
    type Signature = Map<SignerKey, Option<Signature>>;

    #[allow(non_snake_case)]
    fn __check_auth(
        env: Env,
        signature_payload: Hash<32>,
        signatures: Map<SignerKey, Option<Signature>>,
        auth_contexts: Vec<Context>,
    ) -> Result<(), Error> {
        if signatures.len() > 20 {
            panic_with_error!(env, Error::TooManySignatures);
        }

        let mut verifications: [u8; 20] = [0; 20];

        for context in auth_contexts.iter() {
            // TODO consider looping all signatures vs trying to find just one. 
            // Idk this is nice but it creates some tricky trickle issues when trying to verify multiple signers under a single auth context

            // TODO we really shouldn't sign for keys that aren't part of the `authorized_signature`
            // Ideally we find the authorized signature and then we sign anything it requires
            // Then when we check the verifications array later it will actually be accurate

            let authorized_signature =
                signatures
                    .iter()
                    .enumerate()
                    .find(|(i, (signer_key, signature))| {
                        let signer_limits = match get_signer_val_storage(&env, &signer_key, true) {
                            None => panic_with_error!(env, Error::NotFound),
                            Some((signer_val, _)) => {
                                match signature {
                                    None => {
                                        // Skipping as we'll do policy verifications below assuming we're able to find an authorized signature
                                        // TODO Actually maybe we should just run this here...why not?
                                        if let SignerKey::Policy(policy) = signer_key {
                                            // Record if we used this signature for an authorization
                                            if verifications[*i] == 0 {
                                                verifications[*i] = 1;
                                                policy.require_auth_for_args(vec![
                                                    &env,
                                                    // Putting the authorized context in the args to allow the policy to validate
                                                    context.into_val(&env),
                                                ]);
                                            }
                    
                                            // NOTE We don't permit previous verifications to count as authorized in the case of policy signers as contexts could be different between calls
                                            // e.g. We wouldn't want to authenticate a 1 stroop context which would then count towards a 1B XLM context
                                            // This will require placing multiple `.set_auths` to cover all "duplicate" policy call instances. Which is good
                                            // policy.require_auth_for_args(vec![
                                            //     &env,
                                            //     // Putting the authorized context in the args to allow the policy to validate
                                            //     context.into_val(&env),
                                            // ]);
                                        } else {
                                            panic_with_error!(env, Error::InvalidSignatureForSignerKey)
                                        }
                                    }
                                    Some(signature) => {
                                        match signature {
                                            Signature::Ed25519(signature) => {
                                                if let SignerKey::Ed25519(public_key) = signer_key {
                                                    if verifications[*i] == 0 {
                                                        verifications[*i] = 1;
                                                        env.crypto().ed25519_verify(
                                                            &public_key,
                                                            &signature_payload.clone().into(),
                                                            &signature,
                                                        );
                                                    }
                                                } else {
                                                    panic_with_error!(
                                                        env,
                                                        Error::SignatureKeyValueMismatch
                                                    );
                                                }
                                            }
                                            Signature::Secp256r1(_) => {
                                                // Skipping as we do validation below once we've got access to the secp256r1 public key
                                            }
                                        }
                                    }
                                }

                                match signer_val {
                                    SignerVal::Policy(signer_limits) => signer_limits,
                                    SignerVal::Ed25519(signer_limits) => signer_limits,
                                    SignerVal::Secp256r1(public_key, signer_limits) => {
                                        match signature {
                                            Some(signature) => {
                                                if let Signature::Secp256r1(Secp256r1Signature {
                                                    mut authenticator_data,
                                                    client_data_json,
                                                    signature,
                                                }) = signature.clone()
                                                {
                                                    if verifications[*i] == 0 {
                                                        verifications[*i] = 1;
                                                        verify_secp256r1_signature(
                                                            &env,
                                                            &public_key,
                                                            &mut authenticator_data,
                                                            &client_data_json,
                                                            &signature,
                                                            &signature_payload,
                                                        );
                                                    }
                                                } else {
                                                    panic_with_error!(
                                                        env,
                                                        Error::SignatureKeyValueMismatch
                                                    );
                                                }
                                            }
                                            None => {
                                                panic_with_error!(
                                                    env,
                                                    Error::InvalidSignatureForSignerKey
                                                );
                                            }
                                        }

                                        signer_limits
                                    }
                                }
                            }
                        }
                        .0;

                        // If this signature has no limits then yes it's authorized
                        if signer_limits.is_empty() {
                            return true;
                        }

                        match &context {
                            Context::Contract(ContractContext {
                                contract,
                                fn_name,
                                args,
                            }) => {
                                match signer_limits.get(contract.clone()) {
                                    Some(signer_limits_keys) => {
                                        // If this signer has a smart wallet context limit, limit that context to only removing itself
                                        if *contract == env.current_contract_address()
                                            && *fn_name != symbol_short!("remove")
                                            || (*fn_name == symbol_short!("remove")
                                                && SignerKey::from_val(
                                                    &env,
                                                    &args.get_unchecked(0),
                                                ) != *signer_key)
                                        {
                                            return false;
                                        }

                                        return verify_signer_limit_keys(
                                            &env,
                                            &signature_payload,
                                            &signatures,
                                            &context,
                                            &signer_limits_keys,
                                            &mut verifications,
                                            i
                                        );
                                    }
                                    None => return false, // signer limitations not met
                                }
                            }
                            Context::CreateContractHostFn(_) => {
                                match signer_limits.get(env.current_contract_address()) {
                                    Some(signer_limits_keys) => {
                                        return verify_signer_limit_keys(
                                            &env,
                                            &signature_payload,
                                            &signatures,
                                            &context,
                                            &signer_limits_keys,
                                            &mut verifications,
                                            i
                                        );
                                    }
                                    None => return false, // signer limitations not met
                                }
                            }
                        }
                    });

            if let Some((i, (signer_key, signature))) = authorized_signature {
                // Context is authorized, run policy if needed
                // TODO why are we running this here vs in the signatures loop?
                if let SignerKey::Policy(policy) = signer_key {
                    if signature.is_none() {
                        // Record if we used this signature for an authorization
                        if verifications[i] == 0 {
                            verifications[i] = 1;
                            policy.require_auth_for_args(vec![
                                &env,
                                // Putting the authorized context in the args to allow the policy to validate
                                context.into_val(&env),
                            ]);
                        }

                        // NOTE We don't permit previous verifications to count as authorized in the case of policy signers as contexts could be different between calls
                        // e.g. We wouldn't want to authenticate a 1 stroop context which would then count towards a 1B XLM context
                        // This will require placing multiple `.set_auths` to cover all "duplicate" policy call instances. Which is good
                        // policy.require_auth_for_args(vec![
                        //     &env,
                        //     // Putting the authorized context in the args to allow the policy to validate
                        //     context.into_val(&env),
                        // ]);
                    } else {
                        panic_with_error!(env, Error::InvalidSignatureForSignerKey);
                    }
                }
                // else {
                //     // TODO is it safe not to have an else that panics here?
                //     // I think so, we just know we haven't called any policies yet so if the authorized signature is a policy, call it
                // }
            } else {
                panic_with_error!(env, Error::NotAuthorized);
            }
        }

        if verifications.iter().sum::<u8>() != signatures.len() as u8 {
            panic_with_error!(env, Error::ExtraSigners);
        }

        let max_ttl = env.storage().max_ttl();

        env.storage()
            .instance()
            .extend_ttl(max_ttl - WEEK_OF_LEDGERS, max_ttl);

        Ok(())
    }
}

fn verify_signer_limit_keys(
    env: &Env,
    signature_payload: &Hash<32>,
    signatures: &Map<SignerKey, Option<Signature>>,
    context: &Context,
    signer_limits_keys: &Option<Vec<SignerKey>>,
    verifications: &mut [u8; 20],
    i: &usize
) -> bool {
    match signer_limits_keys {
        Some(signer_limits_keys) => {
            for signer_limits_key in signer_limits_keys.iter() {
                // TODO make this a get and use it
                if !signatures.contains_key(signer_limits_key.clone()) {
                    return false; // if any required key is missing this signature is not authorized for this context
                }

                gross_ugly_very_wet_verifier(env, &signer_limits_key, signature_payload, signatures, context, verifications, i);
            }

            // TODO we must ensure these found required signers actually get verified
            // Right now there's a bug when the number of required signatures is greater than the auth contexts

            return true; // all required keys are present
        }
        None => return true, // no key limits
    }
}

fn gross_ugly_very_wet_verifier(env: &Env, signer_key: &SignerKey, signature_payload: &Hash<32>, signatures: &Map<SignerKey, Option<Signature>>, context: &Context, verifications: &mut [u8; 20], i: &usize) {

    // TODO should use `get_signer_val_storage` in order to bump the TTL of the keys
    // as is this is actually a bit dangerous because we're allowing signing with keys that may not exist

    match signatures.get(signer_key.clone()) {
        None => panic_with_error!(env, Error::NotFound),
        Some(signature) => {
            match signature {
                None => {
                    if let SignerKey::Policy(policy) = signer_key {
                        // Record if we used this signature for an authorization
                        if verifications[*i] == 0 {
                            verifications[*i] = 1;
                            // TODO Is it safe to put this call inside the `if verifications[*i] == 0` statement?
                            // If have a concern this will permit issues
                            policy.require_auth_for_args(vec![
                                &env,
                                // Putting the authorized context in the args to allow the policy to validate
                                context.into_val(env),
                            ]);
                        }

                        // NOTE We don't permit previous verifications to count as authorized in the case of policy signers as contexts could be different between calls
                        // e.g. We wouldn't want to authenticate a 1 stroop context which would then count towards a 1B XLM context
                        // This will require placing multiple `.set_auths` to cover all "duplicate" policy call instances. Which is good
                        // policy.require_auth_for_args(vec![
                        //     &env,
                        //     // Putting the authorized context in the args to allow the policy to validate
                        //     context.into_val(env),
                        // ]);
                    } else {
                        panic_with_error!(env, Error::InvalidSignatureForSignerKey)
                    }
                }
                Some(signature) => {
                    match signature {
                        Signature::Ed25519(signature) => {
                            if let SignerKey::Ed25519(public_key) = signer_key {
                                if verifications[*i] == 0 {
                                    verifications[*i] = 1;
                                    env.crypto().ed25519_verify(
                                        &public_key,
                                        &signature_payload.clone().into(),
                                        &signature,
                                    );
                                }
                            } else {
                                panic_with_error!(
                                    env,
                                    Error::SignatureKeyValueMismatch
                                );
                            }
                        }
                        Signature::Secp256r1(Secp256r1Signature {
                            mut authenticator_data,
                            client_data_json,
                            signature,
                        }) => {
                            // TODO Move this up so it protects the whole function call so we don't end up signing for keys that don't exist on the smart wallet
                            match get_signer_val_storage(&env, &signer_key, true) {
                                None => panic_with_error!(env, Error::NotFound),
                                Some((signer_val, _)) => {
                                    if let SignerVal::Secp256r1(public_key, _) = signer_val {
                                        if verifications[*i] == 0 {
                                            verifications[*i] = 1;
                                            verify_secp256r1_signature(
                                                &env,
                                                &public_key,
                                                &mut authenticator_data,
                                                &client_data_json,
                                                &signature,
                                                &signature_payload,
                                            );
                                        }
                                    } else {
                                        panic_with_error!(
                                            env,
                                            Error::SignatureKeyValueMismatch
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

fn get_signer_val_storage(
    env: &Env,
    signer_key: &SignerKey,
    extend_ttl: bool,
) -> Option<(SignerVal, SignerStorage)> {
    let max_ttl = env.storage().max_ttl();

    match env
        .storage()
        .temporary()
        .get::<SignerKey, SignerVal>(signer_key)
    {
        Some(signer_val) => {
            if extend_ttl {
                env.storage().temporary().extend_ttl::<SignerKey>(
                    signer_key,
                    max_ttl - WEEK_OF_LEDGERS,
                    max_ttl,
                );
            }

            Some((signer_val, SignerStorage::Temporary))
        }
        None => {
            match env
                .storage()
                .persistent()
                .get::<SignerKey, SignerVal>(signer_key)
            {
                Some(signer_val) => {
                    if extend_ttl {
                        env.storage().persistent().extend_ttl::<SignerKey>(
                            signer_key,
                            max_ttl - WEEK_OF_LEDGERS,
                            max_ttl,
                        );
                    }

                    Some((signer_val, SignerStorage::Persistent))
                }
                None => None,
            }
        }
    }
}

fn verify_secp256r1_signature(
    env: &Env,
    public_key: &BytesN<65>,
    authenticator_data: &mut Bytes,
    client_data_json: &Bytes,
    signature: &BytesN<64>,
    signature_payload: &Hash<32>,
) {
    authenticator_data.extend_from_array(&env.crypto().sha256(&client_data_json).to_array());

    env.crypto().secp256r1_verify(
        &public_key,
        &env.crypto().sha256(&authenticator_data),
        &signature,
    );

    // Parse the client data JSON, extracting the base64 url encoded challenge.
    let client_data_json = client_data_json.to_buffer::<1024>(); // <- TODO why 1024?
    let client_data_json = client_data_json.as_slice();
    let (client_data_json, _): (ClientDataJson, _) =
        serde_json_core::de::from_slice(client_data_json)
            .unwrap_or_else(|_| panic_with_error!(env, Error::JsonParseError));

    // Build what the base64 url challenge is expecting.
    let mut expected_challenge = [0u8; 43];

    base64_url::encode(&mut expected_challenge, &signature_payload.to_array());

    // Check that the challenge inside the client data JSON that was signed is identical to the expected challenge.
    // TODO is this check actually necessary or is the secp256r1_verify sufficient?
    if client_data_json.challenge.as_bytes() != expected_challenge {
        panic_with_error!(env, Error::ClientDataJsonChallengeIncorrect)
    }
}

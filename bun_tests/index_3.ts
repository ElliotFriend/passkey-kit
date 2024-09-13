import { Address, Contract, Keypair } from '@stellar/stellar-sdk'

// const contract = Buffer.from([
//     40, 76, 4, 220, 239, 185, 174, 223, 218, 252, 223, 244, 153, 121, 154, 92, 108, 72, 251, 184,
//     70, 166, 134, 111, 165, 220, 84, 86, 184, 196, 55, 73,
// ])

// console.log(
//     Address.contract(contract).toString()
// );

// const next = Buffer.from([0, 0, 0, 16, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 15, 0, 0, 0, 8, 67, 111, 110, 116, 114, 97, 99, 116, 0, 0, 0, 17, 0, 0, 0, 1, 0, 0, 0, 3, 0, 0, 0, 15, 0, 0, 0, 4, 97, 114, 103, 115, 0, 0, 0, 16, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 15, 0, 0, 0, 8, 99, 111, 110, 116, 114, 97, 99, 116, 0, 0, 0, 18, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 15, 0, 0, 0, 7, 102, 110, 95, 110, 97, 109, 101, 0, 0, 0, 0, 15, 0, 0, 0, 4, 99, 97, 108, 108])

// console.log(next.toString('base64'));

// const keypair = Keypair.random()

// console.log(
//     keypair.rawSecretKey(),
//     keypair.rawPublicKey(),
// );

console.log(
    Address.contract(Buffer.from(new Array(32).fill(255))).toString()
);

console.log(
    Address.account(Buffer.from(new Array(32).fill(255))).toString()
);

"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.SUBMIT_TRANSACTION_TIMEOUT = exports.HorizonServer = void 0;
var _bignumber = _interopRequireDefault(require("bignumber.js"));
var _stellarBase = require("@stellar/stellar-base");
var _urijs = _interopRequireDefault(require("urijs"));
var _call_builder = require("./call_builder");
var _config = require("../config");
var _errors = require("../errors");
var _account_call_builder = require("./account_call_builder");
var _account_response = require("./account_response");
var _assets_call_builder = require("./assets_call_builder");
var _claimable_balances_call_builder = require("./claimable_balances_call_builder");
var _effect_call_builder = require("./effect_call_builder");
var _friendbot_builder = require("./friendbot_builder");
var _ledger_call_builder = require("./ledger_call_builder");
var _liquidity_pool_call_builder = require("./liquidity_pool_call_builder");
var _offer_call_builder = require("./offer_call_builder");
var _operation_call_builder = require("./operation_call_builder");
var _orderbook_call_builder = require("./orderbook_call_builder");
var _payment_call_builder = require("./payment_call_builder");
var _strict_receive_path_call_builder = require("./strict_receive_path_call_builder");
var _strict_send_path_call_builder = require("./strict_send_path_call_builder");
var _trade_aggregation_call_builder = require("./trade_aggregation_call_builder");
var _trades_call_builder = require("./trades_call_builder");
var _transaction_call_builder = require("./transaction_call_builder");
var _horizon_axios_client = _interopRequireWildcard(require("./horizon_axios_client"));
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && {}.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
/* tslint:disable:variable-name no-namespace */

// eslint-disable-next-line import/no-named-as-default

/**
 * Default transaction submission timeout for Horizon requests, in milliseconds
 * @constant {number}
 * @default 60000
 * @memberof module:Horizon.Server
 */
const SUBMIT_TRANSACTION_TIMEOUT = exports.SUBMIT_TRANSACTION_TIMEOUT = 60 * 1000;
const STROOPS_IN_LUMEN = 10000000;

// ACCOUNT_REQUIRES_MEMO is the base64 encoding of "1".
// SEP 29 uses this value to define transaction memo requirements for incoming payments.
const ACCOUNT_REQUIRES_MEMO = "MQ==";
function getAmountInLumens(amt) {
  return new _bignumber.default(amt).div(STROOPS_IN_LUMEN).toString();
}

/**
 * Server handles the network connection to a [Horizon](https://developers.stellar.org/docs/data/horizon)
 * instance and exposes an interface for requests to that instance.
 * @class
 * @alias module:Horizon.Server
 * @memberof module:Horizon
 *
 * @param {string} serverURL Horizon Server URL (ex. `https://horizon-testnet.stellar.org`).
 * @param {module:Horizon.Server.Options} [opts] Options object
 */
class HorizonServer {
  /**
   * Horizon Server URL (ex. `https://horizon-testnet.stellar.org`)
   *
   * @todo Solve `URI(this.serverURL as any)`.
   */

  constructor(serverURL, opts = {}) {
    this.serverURL = (0, _urijs.default)(serverURL);
    const allowHttp = typeof opts.allowHttp === "undefined" ? _config.Config.isAllowHttp() : opts.allowHttp;
    const customHeaders = {};
    if (opts.appName) {
      customHeaders["X-App-Name"] = opts.appName;
    }
    if (opts.appVersion) {
      customHeaders["X-App-Version"] = opts.appVersion;
    }
    if (opts.authToken) {
      customHeaders["X-Auth-Token"] = opts.authToken;
    }
    if (opts.headers) {
      Object.assign(customHeaders, opts.headers);
    }
    if (Object.keys(customHeaders).length > 0) {
      _horizon_axios_client.default.interceptors.request.use(config => {
        // merge the custom headers with an existing headers, where customs
        // override defaults
        config.headers = config.headers || {};
        config.headers = Object.assign(config.headers, customHeaders);
        return config;
      });
    }
    if (this.serverURL.protocol() !== "https" && !allowHttp) {
      throw new Error("Cannot connect to insecure horizon server");
    }
  }

  /**
   * Get timebounds for N seconds from now, when you're creating a transaction
   * with {@link TransactionBuilder}.
   *
   * By default, {@link TransactionBuilder} uses the current local time, but
   * your machine's local time could be different from Horizon's. This gives you
   * more assurance that your timebounds will reflect what you want.
   *
   * Note that this will generate your timebounds when you **init the transaction**,
   * not when you build or submit the transaction! So give yourself enough time to get
   * the transaction built and signed before submitting.
   *
   * @example
   * const transaction = new StellarSdk.TransactionBuilder(accountId, {
   *   fee: await StellarSdk.Server.fetchBaseFee(),
   *   timebounds: await StellarSdk.Server.fetchTimebounds(100)
   * })
   *   .addOperation(operation)
   *   // normally we would need to call setTimeout here, but setting timebounds
   *   // earlier does the trick!
   *   .build();
   *
   * @param {number} seconds Number of seconds past the current time to wait.
   * @param {boolean} [_isRetry] True if this is a retry. Only set this internally!
   * This is to avoid a scenario where Horizon is horking up the wrong date.
   * @returns {Promise<Timebounds>} Promise that resolves a `timebounds` object
   * (with the shape `{ minTime: 0, maxTime: N }`) that you can set the `timebounds` option to.
   */
  async fetchTimebounds(seconds, _isRetry = false) {
    // AxiosClient instead of this.ledgers so we can get at them headers
    const currentTime = (0, _horizon_axios_client.getCurrentServerTime)(this.serverURL.hostname());
    if (currentTime) {
      return {
        minTime: 0,
        maxTime: currentTime + seconds
      };
    }

    // if this is a retry, then the retry has failed, so use local time
    if (_isRetry) {
      return {
        minTime: 0,
        maxTime: Math.floor(new Date().getTime() / 1000) + seconds
      };
    }

    // otherwise, retry (by calling the root endpoint)
    // toString automatically adds the trailing slash
    await _horizon_axios_client.default.get((0, _urijs.default)(this.serverURL).toString());
    return this.fetchTimebounds(seconds, true);
  }

  /**
   * Fetch the base fee. Since this hits the server, if the server call fails,
   * you might get an error. You should be prepared to use a default value if
   * that happens!
   * @returns {Promise<number>} Promise that resolves to the base fee.
   */
  async fetchBaseFee() {
    const response = await this.feeStats();
    return parseInt(response.last_ledger_base_fee, 10) || 100;
  }

  /**
   * Fetch the fee stats endpoint.
   * @see {@link https://developers.stellar.org/docs/data/horizon/api-reference/aggregations/fee-stats|Fee Stats}
   * @returns {Promise<HorizonApi.FeeStatsResponse>} Promise that resolves to the fee stats returned by Horizon.
   */
  // eslint-disable-next-line require-await
  async feeStats() {
    const cb = new _call_builder.CallBuilder((0, _urijs.default)(this.serverURL));
    cb.filter.push(["fee_stats"]);
    return cb.call();
  }

  /**
   * Submits a transaction to the network.
   *
   * By default this function calls {@link Horizon.Server#checkMemoRequired}, you can
   * skip this check by setting the option `skipMemoRequiredCheck` to `true`.
   *
   * If you submit any number of `manageOffer` operations, this will add an
   * attribute to the response that will help you analyze what happened with
   * your offers.
   *
   * For example, you'll want to examine `offerResults` to add affordances like
   * these to your app:
   * - If `wasImmediatelyFilled` is true, then no offer was created. So if you
   *   normally watch the `Server.offers` endpoint for offer updates, you
   *   instead need to check `Server.trades` to find the result of this filled
   *   offer.
   * - If `wasImmediatelyDeleted` is true, then the offer you submitted was
   *   deleted without reaching the orderbook or being matched (possibly because
   *   your amounts were rounded down to zero). So treat the just-submitted
   *   offer request as if it never happened.
   * - If `wasPartiallyFilled` is true, you can tell the user that
   *   `amountBought` or `amountSold` have already been transferred.
   *
   * @example
   * const res = {
   *   ...response,
   *   offerResults: [
   *     {
   *       // Exact ordered list of offers that executed, with the exception
   *       // that the last one may not have executed entirely.
   *       offersClaimed: [
   *         sellerId: String,
   *         offerId: String,
   *         assetSold: {
   *           type: 'native|credit_alphanum4|credit_alphanum12',
   *
   *           // these are only present if the asset is not native
   *           assetCode: String,
   *           issuer: String,
   *         },
   *
   *         // same shape as assetSold
   *         assetBought: {}
   *       ],
   *
   *       // What effect your manageOffer op had
   *       effect: "manageOfferCreated|manageOfferUpdated|manageOfferDeleted",
   *
   *       // Whether your offer immediately got matched and filled
   *       wasImmediatelyFilled: Boolean,
   *
   *       // Whether your offer immediately got deleted, if for example the order was too small
   *       wasImmediatelyDeleted: Boolean,
   *
   *       // Whether the offer was partially, but not completely, filled
   *       wasPartiallyFilled: Boolean,
   *
   *       // The full requested amount of the offer is open for matching
   *       isFullyOpen: Boolean,
   *
   *       // The total amount of tokens bought / sold during transaction execution
   *       amountBought: Number,
   *       amountSold: Number,
   *
   *       // if the offer was created, updated, or partially filled, this is
   *       // the outstanding offer
   *       currentOffer: {
   *         offerId: String,
   *         amount: String,
   *         price: {
   *           n: String,
   *           d: String,
   *         },
   *
   *         selling: {
   *           type: 'native|credit_alphanum4|credit_alphanum12',
   *
   *           // these are only present if the asset is not native
   *           assetCode: String,
   *           issuer: String,
   *         },
   *
   *         // same as `selling`
   *         buying: {},
   *       },
   *
   *       // the index of this particular operation in the op stack
   *       operationIndex: Number
   *     }
   *   ]
   * }
   *
   * @see {@link https://developers.stellar.org/docs/data/horizon/api-reference/resources/submit-a-transaction|Submit a Transaction}
   * @param {Transaction|FeeBumpTransaction} transaction - The transaction to submit.
   * @param {object} [opts] Options object
   * @param {boolean} [opts.skipMemoRequiredCheck] - Allow skipping memo
   * required check, default: `false`. See
   * [SEP0029](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0029.md).
   * @returns {Promise} Promise that resolves or rejects with response from
   * horizon.
   */
  async submitTransaction(transaction, opts = {
    skipMemoRequiredCheck: false
  }) {
    // only check for memo required if skipMemoRequiredCheck is false and the transaction doesn't include a memo.
    if (!opts.skipMemoRequiredCheck) {
      await this.checkMemoRequired(transaction);
    }
    const tx = encodeURIComponent(transaction.toEnvelope().toXDR().toString("base64"));
    return _horizon_axios_client.default.post((0, _urijs.default)(this.serverURL).segment("transactions").toString(), `tx=${tx}`, {
      timeout: SUBMIT_TRANSACTION_TIMEOUT
    }).then(response => {
      if (!response.data.result_xdr) {
        return response.data;
      }
      const responseXDR = _stellarBase.xdr.TransactionResult.fromXDR(response.data.result_xdr, "base64");

      // TODO: fix stellar-base types.
      const results = responseXDR.result().value();
      let offerResults;
      let hasManageOffer;
      if (results.length) {
        offerResults = results
        // TODO: fix stellar-base types.
        .map((result, i) => {
          if (result.value().switch().name !== "manageBuyOffer" && result.value().switch().name !== "manageSellOffer") {
            return null;
          }
          hasManageOffer = true;
          let amountBought = new _bignumber.default(0);
          let amountSold = new _bignumber.default(0);
          const offerSuccess = result.value().value().success();
          const offersClaimed = offerSuccess.offersClaimed()
          // TODO: fix stellar-base types.
          .map(offerClaimedAtom => {
            const offerClaimed = offerClaimedAtom.value();
            let sellerId = "";
            switch (offerClaimedAtom.switch()) {
              case _stellarBase.xdr.ClaimAtomType.claimAtomTypeV0():
                sellerId = _stellarBase.StrKey.encodeEd25519PublicKey(offerClaimed.sellerEd25519());
                break;
              case _stellarBase.xdr.ClaimAtomType.claimAtomTypeOrderBook():
                sellerId = _stellarBase.StrKey.encodeEd25519PublicKey(offerClaimed.sellerId().ed25519());
                break;
              // It shouldn't be possible for a claimed offer to have type
              // claimAtomTypeLiquidityPool:
              //
              // https://github.com/stellar/stellar-core/blob/c5f6349b240818f716617ca6e0f08d295a6fad9a/src/transactions/TransactionUtils.cpp#L1284
              //
              // However, you can never be too careful.
              default:
                throw new Error(`Invalid offer result type: ${offerClaimedAtom.switch()}`);
            }
            const claimedOfferAmountBought = new _bignumber.default(
            // amountBought is a js-xdr hyper
            offerClaimed.amountBought().toString());
            const claimedOfferAmountSold = new _bignumber.default(
            // amountBought is a js-xdr hyper
            offerClaimed.amountSold().toString());

            // This is an offer that was filled by the one just submitted.
            // So this offer has an _opposite_ bought/sold frame of ref
            // than from what we just submitted!
            // So add this claimed offer's bought to the SOLD count and vice v

            amountBought = amountBought.plus(claimedOfferAmountSold);
            amountSold = amountSold.plus(claimedOfferAmountBought);
            const sold = _stellarBase.Asset.fromOperation(offerClaimed.assetSold());
            const bought = _stellarBase.Asset.fromOperation(offerClaimed.assetBought());
            const assetSold = {
              type: sold.getAssetType(),
              assetCode: sold.getCode(),
              issuer: sold.getIssuer()
            };
            const assetBought = {
              type: bought.getAssetType(),
              assetCode: bought.getCode(),
              issuer: bought.getIssuer()
            };
            return {
              sellerId,
              offerId: offerClaimed.offerId().toString(),
              assetSold,
              amountSold: getAmountInLumens(claimedOfferAmountSold),
              assetBought,
              amountBought: getAmountInLumens(claimedOfferAmountBought)
            };
          });
          const effect = offerSuccess.offer().switch().name;
          let currentOffer;
          if (typeof offerSuccess.offer().value === "function" && offerSuccess.offer().value()) {
            const offerXDR = offerSuccess.offer().value();
            currentOffer = {
              offerId: offerXDR.offerId().toString(),
              selling: {},
              buying: {},
              amount: getAmountInLumens(offerXDR.amount().toString()),
              price: {
                n: offerXDR.price().n(),
                d: offerXDR.price().d()
              }
            };
            const selling = _stellarBase.Asset.fromOperation(offerXDR.selling());
            currentOffer.selling = {
              type: selling.getAssetType(),
              assetCode: selling.getCode(),
              issuer: selling.getIssuer()
            };
            const buying = _stellarBase.Asset.fromOperation(offerXDR.buying());
            currentOffer.buying = {
              type: buying.getAssetType(),
              assetCode: buying.getCode(),
              issuer: buying.getIssuer()
            };
          }
          return {
            offersClaimed,
            effect,
            operationIndex: i,
            currentOffer,
            // this value is in stroops so divide it out
            amountBought: getAmountInLumens(amountBought),
            amountSold: getAmountInLumens(amountSold),
            isFullyOpen: !offersClaimed.length && effect !== "manageOfferDeleted",
            wasPartiallyFilled: !!offersClaimed.length && effect !== "manageOfferDeleted",
            wasImmediatelyFilled: !!offersClaimed.length && effect === "manageOfferDeleted",
            wasImmediatelyDeleted: !offersClaimed.length && effect === "manageOfferDeleted"
          };
        })
        // TODO: fix stellar-base types.
        .filter(result => !!result);
      }
      return {
        ...response.data,
        offerResults: hasManageOffer ? offerResults : undefined
      };
    }).catch(response => {
      if (response instanceof Error) {
        return Promise.reject(response);
      }
      return Promise.reject(new _errors.BadResponseError(`Transaction submission failed. Server responded: ${response.status} ${response.statusText}`, response.data));
    });
  }

  /**
   * Submits an asynchronous transaction to the network. Unlike the synchronous version, which blocks
   * and waits for the transaction to be ingested in Horizon, this endpoint relays the response from
   * core directly back to the user.
   *
   * By default, this function calls {@link HorizonServer#checkMemoRequired}, you can
   * skip this check by setting the option `skipMemoRequiredCheck` to `true`.
   *
   * @see [Submit-Async-Transaction](https://developers.stellar.org/docs/data/horizon/api-reference/resources/submit-async-transaction)
   * @param {Transaction|FeeBumpTransaction} transaction - The transaction to submit.
   * @param {object} [opts] Options object
   * @param {boolean} [opts.skipMemoRequiredCheck] - Allow skipping memo
   * required check, default: `false`. See
   * [SEP0029](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0029.md).
   * @returns {Promise} Promise that resolves or rejects with response from
   * horizon.
   */
  async submitAsyncTransaction(transaction, opts = {
    skipMemoRequiredCheck: false
  }) {
    // only check for memo required if skipMemoRequiredCheck is false and the transaction doesn't include a memo.
    if (!opts.skipMemoRequiredCheck) {
      await this.checkMemoRequired(transaction);
    }
    const tx = encodeURIComponent(transaction.toEnvelope().toXDR().toString("base64"));
    return _horizon_axios_client.default.post((0, _urijs.default)(this.serverURL).segment("transactions_async").toString(), `tx=${tx}`).then(response => response.data).catch(response => {
      if (response instanceof Error) {
        return Promise.reject(response);
      }
      return Promise.reject(new _errors.BadResponseError(`Transaction submission failed. Server responded: ${response.status} ${response.statusText}`, response.data));
    });
  }

  /**
   * @returns {AccountCallBuilder} New {@link AccountCallBuilder} object configured by a current Horizon server configuration.
   */
  accounts() {
    return new _account_call_builder.AccountCallBuilder((0, _urijs.default)(this.serverURL));
  }

  /**
   * @returns {ClaimableBalanceCallBuilder} New {@link ClaimableBalanceCallBuilder} object configured by a current Horizon server configuration.
   */
  claimableBalances() {
    return new _claimable_balances_call_builder.ClaimableBalanceCallBuilder((0, _urijs.default)(this.serverURL));
  }

  /**
   * @returns {LedgerCallBuilder} New {@link LedgerCallBuilder} object configured by a current Horizon server configuration.
   */
  ledgers() {
    return new _ledger_call_builder.LedgerCallBuilder((0, _urijs.default)(this.serverURL));
  }

  /**
   * @returns {TransactionCallBuilder} New {@link TransactionCallBuilder} object configured by a current Horizon server configuration.
   */
  transactions() {
    return new _transaction_call_builder.TransactionCallBuilder((0, _urijs.default)(this.serverURL));
  }

  /**
   * People on the Stellar network can make offers to buy or sell assets. This endpoint represents all the offers on the DEX.
   *
   * You can query all offers for account using the function `.accountId`.
   *
   * @example
   * server.offers()
   *   .forAccount(accountId).call()
   *   .then(function(offers) {
   *     console.log(offers);
   *   });
   *
   * @returns {OfferCallBuilder} New {@link OfferCallBuilder} object
   */
  offers() {
    return new _offer_call_builder.OfferCallBuilder((0, _urijs.default)(this.serverURL));
  }

  /**
   * @param {Asset} selling Asset being sold
   * @param {Asset} buying Asset being bought
   * @returns {OrderbookCallBuilder} New {@link OrderbookCallBuilder} object configured by a current Horizon server configuration.
   */
  orderbook(selling, buying) {
    return new _orderbook_call_builder.OrderbookCallBuilder((0, _urijs.default)(this.serverURL), selling, buying);
  }

  /**
   * Returns
   * @returns {TradesCallBuilder} New {@link TradesCallBuilder} object configured by a current Horizon server configuration.
   */
  trades() {
    return new _trades_call_builder.TradesCallBuilder((0, _urijs.default)(this.serverURL));
  }

  /**
   * @returns {OperationCallBuilder} New {@link OperationCallBuilder} object configured by a current Horizon server configuration.
   */
  operations() {
    return new _operation_call_builder.OperationCallBuilder((0, _urijs.default)(this.serverURL));
  }

  /**
   * @returns {LiquidityPoolCallBuilder} New {@link LiquidityPoolCallBuilder}
   *     object configured to the current Horizon server settings.
   */
  liquidityPools() {
    return new _liquidity_pool_call_builder.LiquidityPoolCallBuilder((0, _urijs.default)(this.serverURL));
  }

  /**
   * The Stellar Network allows payments to be made between assets through path
   * payments. A strict receive path payment specifies a series of assets to
   * route a payment through, from source asset (the asset debited from the
   * payer) to destination asset (the asset credited to the payee).
   *
   * A strict receive path search is specified using:
   *
   * * The destination address.
   * * The source address or source assets.
   * * The asset and amount that the destination account should receive.
   *
   * As part of the search, horizon will load a list of assets available to the
   * source address and will find any payment paths from those source assets to
   * the desired destination asset. The search's amount parameter will be used
   * to determine if there a given path can satisfy a payment of the desired
   * amount.
   *
   * If a list of assets is passed as the source, horizon will find any payment
   * paths from those source assets to the desired destination asset.
   *
   * @param {string|Asset[]} source The sender's account ID or a list of assets. Any returned path will use a source that the sender can hold.
   * @param {Asset} destinationAsset The destination asset.
   * @param {string} destinationAmount The amount, denominated in the destination asset, that any returned path should be able to satisfy.
   * @returns {StrictReceivePathCallBuilder} New {@link StrictReceivePathCallBuilder} object configured with the current Horizon server configuration.
   */
  strictReceivePaths(source, destinationAsset, destinationAmount) {
    return new _strict_receive_path_call_builder.StrictReceivePathCallBuilder((0, _urijs.default)(this.serverURL), source, destinationAsset, destinationAmount);
  }

  /**
   * The Stellar Network allows payments to be made between assets through path payments. A strict send path payment specifies a
   * series of assets to route a payment through, from source asset (the asset debited from the payer) to destination
   * asset (the asset credited to the payee).
   *
   * A strict send path search is specified using:
   *
   * The asset and amount that is being sent.
   * The destination account or the destination assets.
   *
   * @param {Asset} sourceAsset The asset to be sent.
   * @param {string} sourceAmount The amount, denominated in the source asset, that any returned path should be able to satisfy.
   * @param {string|Asset[]} destination The destination account or the destination assets.
   * @returns {StrictSendPathCallBuilder} New {@link StrictSendPathCallBuilder} object configured with the current Horizon server configuration.
   */
  strictSendPaths(sourceAsset, sourceAmount, destination) {
    return new _strict_send_path_call_builder.StrictSendPathCallBuilder((0, _urijs.default)(this.serverURL), sourceAsset, sourceAmount, destination);
  }

  /**
   * @returns {PaymentCallBuilder} New {@link PaymentCallBuilder} instance configured with the current
   * Horizon server configuration.
   */
  payments() {
    return new _payment_call_builder.PaymentCallBuilder((0, _urijs.default)(this.serverURL));
  }

  /**
   * @returns {EffectCallBuilder} New {@link EffectCallBuilder} instance configured with the current
   * Horizon server configuration
   */
  effects() {
    return new _effect_call_builder.EffectCallBuilder((0, _urijs.default)(this.serverURL));
  }

  /**
   * @param {string} address The Stellar ID that you want Friendbot to send lumens to
   * @returns {FriendbotBuilder} New {@link FriendbotBuilder} instance configured with the current
   * Horizon server configuration
   * @private
   */
  friendbot(address) {
    return new _friendbot_builder.FriendbotBuilder((0, _urijs.default)(this.serverURL), address);
  }

  /**
   * Get a new {@link AssetsCallBuilder} instance configured with the current
   * Horizon server configuration.
   * @returns {AssetsCallBuilder} New AssetsCallBuilder instance
   */
  assets() {
    return new _assets_call_builder.AssetsCallBuilder((0, _urijs.default)(this.serverURL));
  }

  /**
   * Fetches an account's most current state in the ledger, then creates and
   * returns an {@link AccountResponse} object.
   *
   * @param {string} accountId - The account to load.
   *
   * @returns {Promise} Returns a promise to the {@link AccountResponse} object
   * with populated sequence number.
   */
  async loadAccount(accountId) {
    const res = await this.accounts().accountId(accountId).call();
    return new _account_response.AccountResponse(res);
  }

  /**
   *
   * @param {Asset} base base asset
   * @param {Asset} counter counter asset
   * @param {number} start_time lower time boundary represented as millis since epoch
   * @param {number} end_time upper time boundary represented as millis since epoch
   * @param {number} resolution segment duration as millis since epoch. *Supported values are 5 minutes (300000), 15 minutes (900000), 1 hour (3600000), 1 day (86400000) and 1 week (604800000).
   * @param {number} offset segments can be offset using this parameter. Expressed in milliseconds. *Can only be used if the resolution is greater than 1 hour. Value must be in whole hours, less than the provided resolution, and less than 24 hours.
   * Returns new {@link TradeAggregationCallBuilder} object configured with the current Horizon server configuration.
   * @returns {TradeAggregationCallBuilder} New TradeAggregationCallBuilder instance
   */
  tradeAggregation(base, counter, start_time, end_time, resolution, offset) {
    return new _trade_aggregation_call_builder.TradeAggregationCallBuilder((0, _urijs.default)(this.serverURL), base, counter, start_time, end_time, resolution, offset);
  }

  /**
   * Check if any of the destination accounts requires a memo.
   *
   * This function implements a memo required check as defined in
   * [SEP-29](https://stellar.org/protocol/sep-29). It will load each account
   * which is the destination and check if it has the data field
   * `config.memo_required` set to `"MQ=="`.
   *
   * Each account is checked sequentially instead of loading multiple accounts
   * at the same time from Horizon.
   *
   * @see {@link https://stellar.org/protocol/sep-29|SEP-29: Account Memo Requirements}
   * @param {Transaction} transaction - The transaction to check.
   * @returns {Promise<void, Error>} - If any of the destination account
   * requires a memo, the promise will throw {@link AccountRequiresMemoError}.
   * @throws  {AccountRequiresMemoError}
   */
  async checkMemoRequired(transaction) {
    if (transaction instanceof _stellarBase.FeeBumpTransaction) {
      transaction = transaction.innerTransaction;
    }
    if (transaction.memo.type !== "none") {
      return;
    }
    const destinations = new Set();

    /* eslint-disable no-continue */
    for (let i = 0; i < transaction.operations.length; i += 1) {
      const operation = transaction.operations[i];
      switch (operation.type) {
        case "payment":
        case "pathPaymentStrictReceive":
        case "pathPaymentStrictSend":
        case "accountMerge":
          break;
        default:
          continue;
      }
      const destination = operation.destination;
      if (destinations.has(destination)) {
        continue;
      }
      destinations.add(destination);

      // skip M account checks since it implies a memo
      if (destination.startsWith("M")) {
        continue;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        const account = await this.loadAccount(destination);
        if (account.data_attr["config.memo_required"] === ACCOUNT_REQUIRES_MEMO) {
          throw new _errors.AccountRequiresMemoError("account requires memo", destination, i);
        }
      } catch (e) {
        if (e instanceof _errors.AccountRequiresMemoError) {
          throw e;
        }

        // fail if the error is different to account not found
        if (!(e instanceof _errors.NotFoundError)) {
          throw e;
        }
        continue;
      }
    }
    /* eslint-enable no-continue */
  }
}

/**
 * Options for configuring connections to Horizon servers.
 * @typedef {object} Options
 * @memberof module:Horizon.Server
 * @property {boolean} [allowHttp] Allow connecting to http servers, default: `false`. This must be set to false in production deployments! You can also use {@link Config} class to set this globally.
 * @property {string} [appName] Allow set custom header `X-App-Name`, default: `undefined`.
 * @property {string} [appVersion] Allow set custom header `X-App-Version`, default: `undefined`.
 * @property {string} [authToken] Allow set custom header `X-Auth-Token`, default: `undefined`.
 */
exports.HorizonServer = HorizonServer;
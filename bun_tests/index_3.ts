import { Networks, Operation, Transaction } from '@stellar/stellar-sdk'

const txn_xdr = 'AAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACZ2gAAAAAAAAAAQAAAAEAAAAAAAAAAAAAAABm9cbgAAAAAAAAAAEAAAAAAAAAGAAAAAAAAAAB15KLcsJwPM/q9+uf9O9NUEpVqLl5/JtFDqLIQrTRzmEAAAAIdHJhbnNmZXIAAAADAAAAEgAAAAHEqqtef1h9hZOQyrCuQRtZ3o8DHtvuSRoq1C8mc+UHHAAAABIAAAABStcRNXctVBwYQExJdAWbrBC3X+B3Ue9QkP4MJ8nhD7UAAAAKAAAAAAAAAAAAAAAAAJiWgAAAAAEAAAABAAAAAcSqq15/WH2Fk5DKsK5BG1nejwMe2+5JGirULyZz5QccVuXL7MuknWEAAkrxAAAAEQAAAAEAAAACAAAAEAAAAAEAAAACAAAADwAAAAdFZDI1NTE5AAAAAA0AAAAgawYrFjEXTyFLVqniIQebbdWimEk+WkHm4UAdwhtQENIAAAAQAAAAAQAAAAIAAAAPAAAAB0VkMjU1MTkAAAAADQAAAEB4a0Pf3RTJS6TOa69dJ7TG5noSSX3OiRRk8xucLNsxgkckcRyeWr18ir8EgFATxz4X2WvJGLMYNDu11ScujcANAAAAEAAAAAEAAAACAAAADwAAAAZQb2xpY3kAAAAAABIAAAABa07R4ERvYHyHhguMb1H1ScVe13IWchSNA5oUEwVRrK8AAAABAAAAAAAAAAHXkotywnA8z+r365/0701QSlWouXn8m0UOoshCtNHOYQAAAAh0cmFuc2ZlcgAAAAMAAAASAAAAAcSqq15/WH2Fk5DKsK5BG1nejwMe2+5JGirULyZz5QccAAAAEgAAAAFK1xE1dy1UHBhATEl0BZusELdf4HdR71CQ/gwnyeEPtQAAAAoAAAAAAAAAAAAAAAAAmJaAAAAAAAAAAAEAAAAAAAAAAQAAAAYAAAAB15KLcsJwPM/q9+uf9O9NUEpVqLl5/JtFDqLIQrTRzmEAAAAUAAAAAQAAAAMAAAAGAAAAAcSqq15/WH2Fk5DKsK5BG1nejwMe2+5JGirULyZz5QccAAAAFVbly+zLpJ1hAAAAAAAAAAYAAAAB15KLcsJwPM/q9+uf9O9NUEpVqLl5/JtFDqLIQrTRzmEAAAAQAAAAAQAAAAIAAAAPAAAAB0JhbGFuY2UAAAAAEgAAAAFK1xE1dy1UHBhATEl0BZusELdf4HdR71CQ/gwnyeEPtQAAAAEAAAAGAAAAAdeSi3LCcDzP6vfrn/TvTVBKVai5efybRQ6iyEK00c5hAAAAEAAAAAEAAAACAAAADwAAAAdCYWxhbmNlAAAAABIAAAABxKqrXn9YfYWTkMqwrkEbWd6PAx7b7kkaKtQvJnPlBxwAAAABAAWL7QAAArgAAAIIAAAAAAACZwQAAAAA'

const txn = new Transaction(txn_xdr, Networks.TESTNET)

const op = txn.operations[0] as Operation.InvokeHostFunction

const sig = op.auth?.[0].credentials().address().signature()

console.log(sig?.map()?.[0].key().toXDR());

console.log(sig?.map()?.[1].key().toXDR());
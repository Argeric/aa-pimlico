import "dotenv/config"
import { createSmartAccountClient } from "permissionless"
import { toSafeSmartAccount } from "permissionless/accounts"
import { createPimlicoClient } from "permissionless/clients/pimlico"
import { Hex, createPublicClient, encodeFunctionData, http, parseAbiItem } from "viem"
import { entryPoint07Address } from "viem/account-abstraction"
import { privateKeyToAccount } from "viem/accounts"
import { sepolia } from "viem/chains"

/*
* 这个例子不能使用erc20PaymasterAddress，而是使用pimlico默认的paymaster，导致在postOp阶段revert
*
* */

// "dependencies": {
//     "dotenv": "^16.3.1",
//         "permissionless": "^0.2.0",
//         "viem": "^2.20.0"
// },
const apiKey = process.env.PIMLICO_API_KEY
if (!apiKey) throw new Error("Missing PIMLICO_API_KEY")

const privateKey = process.env.PRIVATE_KEY as Hex | undefined
if (!privateKey) throw new Error("Missing PRIVATE_KEY")

const erc20PaymasterAddress = "0x000000000041F3aFe8892B48D88b6862efe0ec8d" as const

const usdcAddress = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as const

const publicClient = createPublicClient({
    chain: sepolia,
    transport: http("https://rpc.sepolia.ethpandaops.io"),
})

const pimlicoUrl = `https://api.pimlico.io/v2/sepolia/rpc?apikey=${apiKey}`

const pimlicoClient = createPimlicoClient({
    transport: http(pimlicoUrl),
    entryPoint: {
        address: entryPoint07Address,
        version: "0.7",
    },
})

const owner = privateKeyToAccount(privateKey)

const account = await toSafeSmartAccount( {
    client: publicClient,
    owners: [owner],
    entryPoint: {
        address: entryPoint07Address,
        version: "0.7",
    },
    version: "1.4.1",

    // 首次部署 Safe 时，顺手授权 ERC20 Paymaster 可花 USDC
    setupTransactions: [
        {
            to: usdcAddress,
            value: 0n,
            data: encodeFunctionData({
                abi: [parseAbiItem("function approve(address spender, uint256 amount)")],
                args: [
                    erc20PaymasterAddress,
                    0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffn,
                ],
            }),
        },
    ],
})

console.log(`Smart account address: https://sepolia.etherscan.io/address/${account.address}`)

const senderUsdcBalance = await publicClient.readContract({
    abi: [parseAbiItem("function balanceOf(address account) returns (uint256)")],
    address: usdcAddress,
    functionName: "balanceOf",
    args: [account.address],
})

console.log(`USDC balance: ${senderUsdcBalance}`)

if (senderUsdcBalance < 1_000_000n) {
    throw new Error(
        `Insufficient USDC balance for counterfactual wallet address ${account.address}: ${
            Number(senderUsdcBalance) / 1000000
        } USDC, required at least 1 USDC. Load up balance at https://faucet.circle.com/`,
    )
}

console.log(`Smart account USDC balance: ${Number(senderUsdcBalance) / 1000000} USDC`)

const smartAccountClient = createSmartAccountClient({
    client: publicClient,
    account,
    chain: sepolia,
    bundlerTransport: http(pimlicoUrl),
    paymaster: {
        async getPaymasterStubData(parameters) {
            // 先拿 stub data 给 gas estimation 使用
            return await pimlicoClient.getPaymasterStubData({
                ...parameters,
                // 关键：指定 ERC20 paymaster
                paymaster: erc20PaymasterAddress,
                // 关键：传 ERC20 paymaster context
                context: {
                    token: usdcAddress,
                },
            } as any)
        },
        async getPaymasterData(parameters) {
            // 真正拿可用的 paymasterData
            return await pimlicoClient.getPaymasterData({
                ...parameters,
                // 关键：指定 ERC20 paymaster
                paymaster: erc20PaymasterAddress,
                // 关键：传 ERC20 paymaster context
                context: {
                    token: usdcAddress,
                },
            } as any)
        },
    },
    userOperation: {
        estimateFeesPerGas: async () => {
            return (await pimlicoClient.getUserOperationGasPrice()).fast
        },
    }
})

const txHash = await smartAccountClient.sendTransaction({
    to: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
    value: 1n,
    // data: "0x1234",
})

console.log(`User operation included: https://sepolia.etherscan.io/tx/${txHash}`)
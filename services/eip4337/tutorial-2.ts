import {createPublicClient, http, parseEther, Hex, getAddress, encodeFunctionData, parseAbi, maxUint256} from 'viem'
import { generatePrivateKey, privateKeyToAccount, } from 'viem/accounts'
import { createPimlicoClient } from 'permissionless/clients/pimlico'
import { createSmartAccountClient } from 'permissionless'
import { toSafeSmartAccount } from 'permissionless/accounts'
import 'dotenv/config'

// "dependencies": {
//     "dotenv": "^16.3.1",
//         "permissionless": "^0.2.0",
//         "viem": "^2.20.0"
// },

import fs from 'fs'
import path from 'path'

// ============================================================
// 1. 配置常量 - Sepolia测试网
// ============================================================

// Sepolia 测试网配置
// 注意：如果官方尚未更新，可能需要手动添加Sepolia的Chain配置
// Sepolia Chain ID: 11155111 (请确认最新值)
const Sepolia_CHAIN = {
    id: 11155111,
    name: 'Sepolia',
    network: 'sepolia',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
        default: { http: ['https://rpc.sepolia.ethpandaops.io'] },
        public: { http: ['https://rpc.sepolia.ethpandaops.io'] }
    }
}

// EntryPoint 地址
// 0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789 (ERC-4337 v0.6)
// 0x0000000071727De22E5E9d8BAf0edAc6f37da032 (ERC-4337 v0.7)
const ENTRY_POINT_ADDRESS = '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as const;

// 目标地址 (Vitalik的ETH地址，仅作示例)
const TARGET_ADDRESS = '0x888a6bf26964af9d7eed9e03e53415d37aa96045'

// USDC address
const usdc = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'

// ============================================================
// 2. 初始化客户端
// ============================================================

async function main() {
    console.log('=== Sepolia测试网 AA UserOperation 示例 ===\n')

    // 2.1 创建公共客户端 - 连接Sepolia RPC
    const publicClient: any = createPublicClient({
        chain: Sepolia_CHAIN,
        transport: http('https://rpc.sepolia.ethpandaops.io')
    })
    console.log('✓ 公共客户端已创建')

    // 2.2 创建Bundler客户端 (使用Pimlico)
    // 注意：Pimlico可能尚未支持Sepolia，需要确认或使用其他Bundler
    // 如果Pimlico不支持Sepolia，可以自建Bundler或使用其他服务
    const apiKey = process.env.PIMLICO_API_KEY
    if (!apiKey) {
        console.warn('⚠️ 未设置PIMLICO_API_KEY环境变量')
        console.warn('   如果Pimlico不支持Sepolia，请使用其他Bundler方案')
        process.exit(10)
    }

    // 对于Sepolia测试网，可能需要使用本地Bundler或其他RPC
    // 这里提供一个备用方案：直接使用支持AA的RPC节点
    const bundlerUrl = `https://api.pimlico.io/v2/${Sepolia_CHAIN.id}/rpc?apikey=${apiKey}`

    let pimlicoClient: any
    try {
        pimlicoClient = createPimlicoClient({
            chain: Sepolia_CHAIN,
            transport: http(bundlerUrl),
            entryPoint: {
                address: ENTRY_POINT_ADDRESS,
                version: '0.7'
            } as any
        })
        console.log('✓ Pimlico客户端已创建')
    } catch (error) {
        console.log('⚠️ Pimlico客户端创建失败，将使用备用配置')
    }

    // ============================================================
    // 3. 创建钱包Owner
    // ============================================================

    // 读取或生成私钥
    const envPath = path.join(process.cwd(), '.env')
    let privateKey: Hex

    if (fs.existsSync(envPath) && process.env.PRIVATE_KEY) {
        privateKey = process.env.PRIVATE_KEY as Hex
        console.log('✓ 使用已有私钥')
    } else {
        privateKey = generatePrivateKey()
        fs.writeFileSync(envPath, `PRIVATE_KEY=${privateKey}\nPIMLICO_API_KEY=your_api_key_here`)
        console.log('✓ 生成新私钥并保存到.env')
        console.log(`   请将ETH转入以下地址后重新运行脚本`)
    }

    const owner = privateKeyToAccount(privateKey)
    console.log(`\nOwner地址: ${owner.address}`)
    console.log(`请确保Owner地址有足够的Sepolia ETH作为Gas费`)

    // ============================================================
    // 4. 创建智能合约账户 (Smart Account)
    // ============================================================

    // 使用Safe账户作为智能合约钱包
    const safeAccount = await toSafeSmartAccount({
        client: publicClient,
        owners: [owner],
        version: '1.4.1',
        entryPoint: {
            address: ENTRY_POINT_ADDRESS as `0x${string}`,
            version: '0.7'
        }
    } as any)

    console.log(`\n✓ 智能账户已创建`)
    console.log(`   Smart Account地址: ${safeAccount.address}`)
    console.log(`   查看: https://sepolia.beaconcha.in/address/${safeAccount.address}`)

    // ============================================================
    // 5. 检查账户余额
    // ============================================================

    /*const balance = await publicClient.getBalance({ address: safeAccount.address })
    console.log(`\n智能账户余额: ${Number(balance) / 1e18} ETH`)

    if (balance === 0n) {
        console.error('\n❌ 错误: 智能账户余额为0')
        console.error(`   请向 ${safeAccount.address} 转入至少 0.01 ETH`)
        console.error('   然后重新运行脚本')
        return
    }*/

    const senderUsdcBalance = await publicClient.readContract({
        abi: parseAbi(["function balanceOf(address account) returns (uint256)"]),
        address: usdc,
        functionName: "balanceOf",
        args: [safeAccount.address],
    })

    if (senderUsdcBalance < 1_000_000n) {
        throw new Error(
            `insufficient USDC balance for counterfactual wallet address ${safeAccount.address}: ${
                Number(senderUsdcBalance) / 1_000_000
            } USDC, required at least 1 USDC. Load up balance at https://faucet.circle.com/`,
        )
    }

    console.log("Smart account USDC balance: ", Number(senderUsdcBalance) / 1_000_000)

    // ============================================================
    // 6. 创建智能账户客户端
    // ============================================================

    // 配置Gas估算函数
    const getGasPrices = async () => {
        if (pimlicoClient) {
            try {
                return (await pimlicoClient.getUserOperationGasPrice()).fast
            } catch (error) {
                console.log('使用Pimlico Gas价格失败，使用默认值')
            }
        }
        // 备用：从RPC获取Fee数据
        const fees = await publicClient.estimateFeesPerGas()
        return {
            maxFeePerGas: fees.maxFeePerGas || 10_000_000_000n,
            maxPriorityFeePerGas: fees.maxPriorityFeePerGas || 1_000_000_000n
        }
    }

    const smartAccountClient: any = createSmartAccountClient({
        account: safeAccount,
        chain: Sepolia_CHAIN,
        bundlerTransport: http(bundlerUrl),
        paymaster: pimlicoClient || undefined, // 如果有Paymaster则使用
        userOperation: {
            estimateFeesPerGas: async () => {
                return await getGasPrices()
            }
        }
    })

    console.log('\n✓ 智能账户客户端已创建')

    // ============================================================
    // 7. 构建并发送UserOperation
    // ============================================================

    console.log('\n=== 发送UserOperation ===')
    console.log(`目标地址: ${TARGET_ADDRESS}`)

    try {
        const quotes = await pimlicoClient.getTokenQuotes({
            tokens: [usdc]
        })
        const paymaster = quotes[0].paymaster

        const txHash = await smartAccountClient.sendTransaction({
            calls: [
                {
                    to: getAddress(usdc),
                    abi: parseAbi(["function approve(address,uint)"]),
                    functionName: "approve",
                    args: [paymaster, maxUint256],
                },
                {
                    to: getAddress("0xd8da6bf26964af9d7eed9e03e53415d37aa96045"),
                    data: "0x1234" as Hex,
                },
            ],
            paymasterContext: {
                token: usdc,
            },
        })

        console.log(`\n✅ UserOperation已提交!`)
        console.log(`   交易Hash: ${txHash}`)
        console.log(`   查看: https://sepolia.beaconcha.in/tx/${txHash}`)

    } catch (error) {
        console.error('\n❌ 发送UserOperation失败:', error)
    }
}

// ============================================================
// 8. 运行主函数
// ============================================================

main().catch(console.error)

import { createConfig, http } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { appChain, rpcUrl } from './config'

export const wagmiConfig = createConfig({
  chains: [appChain],
  connectors: [injected()],
  transports: {
    [appChain.id]: http(rpcUrl),
  },
})

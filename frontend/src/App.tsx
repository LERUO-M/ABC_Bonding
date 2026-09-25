import { Header } from './components/Header'
import { Dashboard } from './components/Dashboard'
import { BondPanel } from './components/BondPanel'
import { StakePanel } from './components/StakePanel'
import { ProtocolStatus } from './components/ProtocolStatus'
import { appChain, contracts, isConfigured } from './config'
import './App.css'

function App() {
  return (
    <div className="app">
      <Header />

      {!isConfigured() ? (
        <section className="card card-warn setup-card">
          <h2>Configuration required</h2>
          <p>
            Set contract addresses in <code>.env</code> (see <code>.env.example</code>).
          </p>
          <ul>
            <li>
              <code>VITE_BOND_DEPOSITORY</code> — currently{' '}
              <code>{contracts.bondDepository ?? 'unset'}</code>
            </li>
            <li>
              <code>VITE_STAKING</code> — currently <code>{contracts.staking ?? 'unset'}</code>
            </li>
            <li>
              <code>VITE_RPC_URL</code> — currently <code>{appChain.rpcUrls.default.http[0]}</code>
            </li>
            <li>
              <code>VITE_CHAIN_ID</code> — currently <code>{appChain.id}</code>
            </li>
          </ul>
        </section>
      ) : (
        <>
          <ProtocolStatus />
          <Dashboard />
          <main className="main-grid">
            <BondPanel />
            <StakePanel />
          </main>
        </>
      )}

      <footer className="footer">
        <p>ABC Trust Bonding · Configure addresses after deploy · Not financial advice</p>
      </footer>
    </div>
  )
}

export default App

import { Link, useLocation } from "react-router-dom";
import type { WalletState } from "../types";

interface NavbarProps {
  wallet: WalletState;
}

export default function Navbar({ wallet }: NavbarProps) {
  const location = useLocation();
  const { account, connect, isConnecting } = wallet;

  const shortAddr = account
    ? `${account.slice(0, 6)}...${account.slice(-4)}`
    : null;

  return (
    <nav className="navbar">
      <Link to="/" className="navbar-logo">
        <div className="navbar-logo-icon">🌱</div>
        ImpactFund
      </Link>

      <div className="navbar-links">
        <Link
          to="/"
          className={`navbar-link ${location.pathname === "/" ? "active" : ""}`}
        >
          Explore
        </Link>
        <Link
          to="/create"
          className={`navbar-link ${location.pathname === "/create" ? "active" : ""}`}
        >
          Create Campaign
        </Link>
        {account && (
          <Link
            to="/dashboard"
            className={`navbar-link ${location.pathname === "/dashboard" ? "active" : ""}`}
          >
            Dashboard
          </Link>
        )}

        {account ? (
          <div className="wallet-badge">{shortAddr}</div>
        ) : (
          <button
            className="neo-btn neo-btn-primary"
            style={{ padding: "8px 20px", fontSize: 14 }}
            onClick={connect}
            disabled={isConnecting}
          >
            {isConnecting ? "Connecting..." : "🦊 Connect Wallet"}
          </button>
        )}
      </div>
    </nav>
  );
}

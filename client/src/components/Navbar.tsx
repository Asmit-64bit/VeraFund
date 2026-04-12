import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import type { WalletState } from "../types";

interface NavbarProps {
  wallet: WalletState;
}

export default function Navbar({ wallet }: NavbarProps) {
  const location = useLocation();
  const { account, connect, disconnect, isConnecting } = wallet;
  const [menuOpen, setMenuOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (!menuRef.current || menuRef.current.contains(event.target as Node)) return;
      setMenuOpen(false);
    }

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
    setNavOpen(false);
  }, [location.pathname]);

  return (
    <nav className="navbar">
      <Link to="/" className="navbar-logo">
        <img src="/assets/veraFundLogo.png" alt="VeraFund logo" className="navbar-logo-image" />
        <span>verafund</span>
      </Link>

      <button
        type="button"
        className="neo-btn neo-btn-outline navbar-mobile-toggle"
        onClick={() => setNavOpen((open) => !open)}
        aria-expanded={navOpen}
        aria-label="Toggle navigation"
      >
        {navOpen ? "Close" : "Menu"}
      </button>

      <div className={`navbar-links ${navOpen ? "open" : ""}`}>
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
          New Campaign
        </Link>

        {account ? (
          <div className="navbar-menu" ref={menuRef}>
            <button
              type="button"
              className={`neo-btn navbar-account-trigger ${
                location.pathname === "/profile" || location.pathname === "/dashboard" ? "active" : ""
              }`}
              onClick={() => setMenuOpen((open) => !open)}
            >
              Profile
            </button>

            {menuOpen && (
              <div className="navbar-dropdown neo-card">
                <div className="navbar-dropdown-heading">My account</div>
                <Link to="/profile" className="navbar-dropdown-link">
                  My Profile
                </Link>
                <Link to="/dashboard" className="navbar-dropdown-link">
                  Dashboard
                </Link>
                <button
                  type="button"
                  className="navbar-dropdown-link navbar-dropdown-button"
                  onClick={() => {
                    disconnect();
                    setMenuOpen(false);
                  }}
                >
                  Log Out
                </button>
              </div>
            )}
          </div>
        ) : (
          <button
            className="neo-btn neo-btn-primary"
            style={{ padding: "8px 18px", fontSize: 14 }}
            onClick={() => {
              setNavOpen(false);
              connect();
            }}
            disabled={isConnecting}
          >
            {isConnecting ? "Connecting..." : "Connect Wallet"}
          </button>
        )}
      </div>
    </nav>
  );
}

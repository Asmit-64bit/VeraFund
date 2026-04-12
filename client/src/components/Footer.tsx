export default function Footer() {
  return (
    <footer className="footer">
      <div>
        <div className="footer-brand">VeraFund</div>
        <div className="footer-sub">
          Milestone-gated donation escrow on Ethereum
        </div>
      </div>
      <div className="footer-links">
        <a
          href="https://sepolia.etherscan.io/address/0x6A837595E2592d699d48eB2DAcF47Df9493035d2"
          target="_blank"
          rel="noopener noreferrer"
          className="tx-link"
        >
          Contract
        </a>
        <a
          href="https://github.com/Arav-Arun/VeraFund"
          target="_blank"
          rel="noopener noreferrer"
          className="tx-link"
        >
          Source
        </a>
      </div>
    </footer>
  );
}

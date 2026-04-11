export default function Footer() {
  return (
    <footer className="footer">
      <div>
        <div className="footer-brand">🌱 ImpactFund</div>
        <div className="footer-sub">
          Transparent milestone-gated donations on Ethereum Sepolia
        </div>
      </div>
      <div className="footer-links">
        <a
          href="https://sepolia.etherscan.io/address/0xC37cb2Eb3ef384906F8Cc48bCa889449B1E7F83D"
          target="_blank"
          rel="noopener noreferrer"
          className="tx-link"
        >
          Factory Contract ↗
        </a>
        <a
          href="https://sepolia.etherscan.io/address/0x7ec109b7931cdc7a3869a033E4fb5cF9a934670c"
          target="_blank"
          rel="noopener noreferrer"
          className="tx-link"
        >
          DonorNFT ↗
        </a>
        <a
          href="https://github.com/Arav-Arun/ImpactFund"
          target="_blank"
          rel="noopener noreferrer"
          className="tx-link"
        >
          GitHub ↗
        </a>
      </div>
    </footer>
  );
}

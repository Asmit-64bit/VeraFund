export default function Footer() {
  return (
    <footer
      style={{
        borderTop: "3px solid #1a1a1a",
        padding: "32px",
        marginTop: 64,
        background: "#ffffff",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 16,
      }}
    >
      <div>
        <span style={{ fontWeight: 700, fontSize: 18 }}>🌱 ImpactFund</span>
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
          Transparent milestone-gated donations on Ethereum
        </p>
      </div>
      <div style={{ display: "flex", gap: 16, fontSize: 14 }}>
        <a
          href="https://sepolia.etherscan.io/address/0xC37cb2Eb3ef384906F8Cc48bCa889449B1E7F83D"
          target="_blank"
          rel="noopener noreferrer"
          className="tx-link"
        >
          Factory Contract ↗
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

import { BLOCK_EXPLORER_URL, FACTORY_ADDRESS } from "../constants";

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
          href={`${BLOCK_EXPLORER_URL}/address/${FACTORY_ADDRESS}`}
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

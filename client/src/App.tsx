import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { useWallet } from "./hooks/useWallet";
import Navbar from "./components/Navbar";
import Footer from "./components/Footer";
import Home from "./pages/Home";
import CampaignDetail from "./pages/CampaignDetail";
import CreateCampaign from "./pages/CreateCampaign";
import Dashboard from "./pages/Dashboard";
import "./index.css";

function App() {
  const wallet = useWallet();

  return (
    <BrowserRouter>
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            fontFamily: "var(--font-display)",
            fontWeight: 600,
            border: "3px solid #1a1a1a",
            borderRadius: "12px",
            boxShadow: "4px 4px 0px #1a1a1a",
            padding: "12px 16px",
          },
        }}
      />

      {wallet.isWrongNetwork && (
        <div className="wrong-network-bar">
          ⚠️ Wrong network! Please switch to Sepolia.
          <button
            className="neo-btn neo-btn-outline"
            style={{ padding: "6px 16px", fontSize: 14 }}
            onClick={wallet.switchToSepolia}
          >
            Switch to Sepolia
          </button>
        </div>
      )}

      <Navbar wallet={wallet} />

      <Routes>
        <Route path="/" element={<Home wallet={wallet} />} />
        <Route
          path="/campaign/:address"
          element={<CampaignDetail wallet={wallet} />}
        />
        <Route
          path="/create"
          element={<CreateCampaign wallet={wallet} />}
        />
        <Route
          path="/dashboard"
          element={<Dashboard wallet={wallet} />}
        />
      </Routes>

      <Footer />
    </BrowserRouter>
  );
}

export default App;

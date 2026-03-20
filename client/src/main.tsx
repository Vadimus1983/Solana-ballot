// Buffer must be polyfilled before any Solana/Anchor imports.
import { Buffer } from "buffer";
(window as any).Buffer = Buffer;

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./index.css";
import App from "./App";

const wallets = [new PhantomWalletAdapter()];
// Point at devnet — change to mainnet-beta or a local validator as needed.
const endpoint = "https://api.devnet.solana.com";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <App />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  </StrictMode>
);

'use client';

import React, { FC, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ConnectionProvider,
  useWallet,
  WalletProvider as WalletProviderWrapper,
} from '@solana/wallet-adapter-react';
import { useWalletMultiButton } from '@solana/wallet-adapter-base-ui';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { BitgetWalletAdapter } from '@solana/wallet-adapter-bitkeep';
import { CloverWalletAdapter } from '@solana/wallet-adapter-clover';
import { Coin98WalletAdapter } from '@solana/wallet-adapter-coin98';
import { FractalWalletAdapter } from '@solana/wallet-adapter-fractal';
import { HyperPayWalletAdapter } from '@solana/wallet-adapter-hyperpay';
import { KeystoneWalletAdapter } from '@solana/wallet-adapter-keystone';
import { KrystalWalletAdapter } from '@solana/wallet-adapter-krystal';
import { LedgerWalletAdapter } from '@solana/wallet-adapter-ledger';
import { MathWalletAdapter } from '@solana/wallet-adapter-mathwallet';
import { NightlyWalletAdapter } from '@solana/wallet-adapter-nightly';
import { NufiWalletAdapter } from '@solana/wallet-adapter-nufi';
import { OntoWalletAdapter } from '@solana/wallet-adapter-onto';
import { ParticleAdapter } from '@solana/wallet-adapter-particle';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SafePalWalletAdapter } from '@solana/wallet-adapter-safepal';
import { SaifuWalletAdapter } from '@solana/wallet-adapter-saifu';
import { SalmonWalletAdapter } from '@solana/wallet-adapter-salmon';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';
import { TokenaryWalletAdapter } from '@solana/wallet-adapter-tokenary';
import { TokenPocketWalletAdapter } from '@solana/wallet-adapter-tokenpocket';
import { TorusWalletAdapter } from '@solana/wallet-adapter-torus';
import { TrustWalletAdapter } from '@solana/wallet-adapter-trust';
import { XDEFIWalletAdapter } from '@solana/wallet-adapter-xdefi';
import {
  WalletModalProvider,
  useWalletModal,
} from '@solana/wallet-adapter-react-ui';
import { clusterApiUrl } from '@solana/web3.js';

// Default styles that can be overridden by your app
import '@solana/wallet-adapter-react-ui/styles.css';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { WalletUiProvider } from '@gitroom/frontend/components/auth/providers/placeholder/wallet.ui.provider';

const NETWORK = WalletAdapterNetwork.Mainnet;
const ENDPOINT = clusterApiUrl(NETWORK);

const WalletProvider = () => {
  const gotoLogin = useCallback(async (code: string) => {
    window.location.href = `/auth?provider=FARCASTER&code=${code}`;
  }, []);
  return <ButtonCaster login={gotoLogin} />;
};
export const ButtonCaster: FC<{
  login: (code: string) => void;
}> = (props) => {
  const wallets = useMemo(
    () => [
      new TokenPocketWalletAdapter(),
      new TorusWalletAdapter(),
      new BitgetWalletAdapter(),
      new CloverWalletAdapter(),
      new Coin98WalletAdapter(),
      new FractalWalletAdapter(),
      new HyperPayWalletAdapter(),
      new KeystoneWalletAdapter(),
      new KrystalWalletAdapter(),
      new LedgerWalletAdapter(),
      new MathWalletAdapter(),
      new NightlyWalletAdapter(),
      new NufiWalletAdapter(),
      new OntoWalletAdapter(),
      new ParticleAdapter(),
      new PhantomWalletAdapter(),
      new SafePalWalletAdapter(),
      new SaifuWalletAdapter(),
      new SalmonWalletAdapter(),
      new SolflareWalletAdapter(),
      new TokenaryWalletAdapter(),
      new TrustWalletAdapter(),
      new XDEFIWalletAdapter(),
    ],
    []
  );
  return (
    <ConnectionProvider endpoint={ENDPOINT}>
      <WalletProviderWrapper wallets={wallets} autoConnect={false}>
        <WalletModalProvider>
          <DisabledAutoConnect />
        </WalletModalProvider>
      </WalletProviderWrapper>
    </ConnectionProvider>
  );
};
const DisabledAutoConnect = () => {
  const [connect, setConnect] = useState(false);
  const wallet = useWallet();
  const toConnect = useCallback(async () => {
    try {
      wallet.select(null);
    } catch (err) {
      /** empty */
    }
    try {
      await wallet.disconnect();
    } catch (err) {
      /** empty */
    }
    setConnect(true);
  }, [wallet]);
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void toConnect();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [toConnect]);
  if (connect) {
    return <InnerWallet />;
  }
  return <WalletUiProvider />;
};
const InnerWallet = () => {
  const walletModal = useWalletModal();
  const wallet = useWallet();
  const fetch = useFetch();
  const { buttonState } = useWalletMultiButton({
    onSelectWallet: () => {
      return;
    },
  });
  const connect = useCallback(async () => {
    if (buttonState !== 'connected') {
      return;
    }
    try {
      const challenge = await (
        await fetch(
          `/auth/oauth/WALLET?publicKey=${wallet?.publicKey?.toString()}`
        )
      ).text();
      const encoded = new TextEncoder().encode(challenge);
      const signed = await wallet?.signMessage?.(encoded)!;
      const info = Buffer.from(
        JSON.stringify({
          // @ts-ignore
          signature: Buffer.from(signed).toString('hex'),
          challenge,
          publicKey: wallet?.publicKey?.toString(),
        })
      ).toString('base64');
      window.location.href = `/auth?provider=WALLET&code=${info}`;
    } catch (err) {
      walletModal.setVisible(false);
      wallet.select(null);
      wallet.disconnect().catch(() => {
        /** empty */
      });
    }
  }, [buttonState, fetch, wallet, walletModal]);
  useEffect(() => {
    if (buttonState === 'has-wallet') {
      wallet
        .connect()
        .then(() => {
          /** empty */
        })
        .catch(() => {
          wallet.select(null);
          wallet.disconnect();
        });
    }
    if (buttonState === 'connected') {
      connect();
    }
  }, [buttonState, connect, wallet]);
  return (
    <div onClick={() => walletModal.setVisible(true)} className="flex-1">
      <WalletUiProvider />
    </div>
  );
};
export default WalletProvider;

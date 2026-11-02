import { BearbyProviderImpl } from './src/bearby-provider';
import { announceProvider, setupEIP6963RequestListener } from './src/eip6963-utils';
import { BearbySolanaProvider } from './src/solana-provider';
import { registerSolanaStandardWallets } from './src/solana-wallet-standard';

export * from './src/types';
export * from './src/bearby-provider';
export * from './src/solana-provider';
export * from './src/solana-utils';
export * from './src/solana-wallet-standard';

function setGlobalProperty(target: any, key: string, value: any): void {
  try {
    Object.defineProperty(target, key, {
      value,
      writable: true,
      configurable: true,
    });
  } catch {
    try {
      target[key] = value;
    } catch {
      // ignore if non-configurable
    }
  }
}

(function() {
  if (typeof window === 'undefined' || !window) {
    console.warn('No window object available for Bearby injection');
    return;
  }

  if ((window as any).__bearbyInjected) {
    if ((window as any).ethereum?.isBearby) {
      announceProvider((window as any).ethereum);
    }
    return;
  }

  try {
    const provider = new BearbyProviderImpl();
    const solanaProvider = new BearbySolanaProvider(provider);
    provider.setSolanaProvider(solanaProvider);

    if (!('ethereum' in window) || !window.ethereum) {
      try {
        Object.defineProperty(window, 'ethereum', {
          value: provider,
          writable: false,
          configurable: true,
        });
      } catch (defineError) {
        (window as any).ethereum = provider;
        console.warn('Using fallback assignment for ethereum due to:', defineError);
      }
    }

    (window as any).coinbaseWalletExtension = provider;

    // Inject Solana legacy globals & multi-wallet objects (Phantom, Solflare, Backpack, Trust, OKX, Coinbase, Bearby)
    setGlobalProperty(window, 'solana', solanaProvider);
    setGlobalProperty(window, 'solflare', solanaProvider);
    setGlobalProperty(window, 'coinbaseSolana', solanaProvider);
    setGlobalProperty(window, 'phantom', {
      ...((window as any).phantom || {}),
      solana: solanaProvider,
      ethereum: provider,
    });
    setGlobalProperty(window, 'backpack', {
      ...((window as any).backpack || {}),
      solana: solanaProvider,
      ethereum: provider,
      isBackpack: true,
    });
    setGlobalProperty(window, 'trustwallet', {
      ...((window as any).trustwallet || {}),
      solana: solanaProvider,
      ethereum: provider,
    });
    setGlobalProperty(window, 'okxwallet', {
      ...((window as any).okxwallet || {}),
      solana: solanaProvider,
      ethereum: provider,
    });
    setGlobalProperty(window, 'bearby', {
      ...((window as any).bearby || {}),
      ethereum: provider,
      solana: solanaProvider,
    });

    announceProvider(provider);
    setupEIP6963RequestListener(provider);
    registerSolanaStandardWallets(solanaProvider);

    (window as any).__bearby_response_handlers = (window as any).__bearby_response_handlers || {};
    (window as any).__bearbyInjected = true;
    window.dispatchEvent(new Event('ethereum#initialized'));
    window.dispatchEvent(new Event('solana#initialized'));
  } catch (error) {
    console.error('Failed to inject Ethereum/Solana provider:', error);
  }
})();

import { BearbyProviderImpl } from './src/bearby-provider';
import { announceProvider, setupEIP6963RequestListener } from './src/eip6963-utils';

export * from './src/types';
export * from './src/bearby-provider';

(function() {
  if (typeof window === 'undefined' || !window) {
    console.warn('No window object available for Bearby injection');
    return;
  }

  if ((window as any).__bearbyInjected) {
    return;
  }

  try {
    const provider = new BearbyProviderImpl();

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

    announceProvider(provider);
    setupEIP6963RequestListener(provider);

    (window as any).__bearby_response_handlers = (window as any).__bearby_response_handlers || {};
    (window as any).__bearbyInjected = true;
    window.dispatchEvent(new Event('ethereum#initialized'));
  } catch (error) {
    console.error('Failed to inject Ethereum provider:', error);
  }
})();

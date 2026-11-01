import { getBearbyIcon } from './eip6963-utils';
import { BearbySolanaProvider, SOLANA_CHAINS, SOLANA_FEATURES } from './solana-provider';
import { base58Decode, ensureUint8Array, type SolanaSignInInput } from './solana-utils';

export interface StandardWalletAccount {
  readonly address: string;
  readonly publicKey: Uint8Array;
  readonly chains: readonly string[];
  readonly features: readonly string[];
  readonly label?: string;
  readonly icon?: string;
}

export type StandardChangeProperties = {
  readonly chains?: readonly string[];
  readonly features?: Record<string, unknown>;
  readonly accounts?: readonly StandardWalletAccount[];
};

export type StandardChangeListener = (properties: StandardChangeProperties) => void;

const PHANTOM_ICON =
  'data:image/svg+xml;base64,' +
  btoa(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none"><rect width="128" height="128" rx="28" fill="#AB9FF2"/><path d="M96.5 64.8C96.5 44.5 79.8 28 59.2 28C36.8 28 19 46.8 19 69.2C19 88.2 31.8 98 43.2 98C51.6 98 57.5 92.6 60.6 88.2C61.8 93.4 66.2 98 72.8 98C80.2 98 86 92.2 87.6 86.4C93.2 81.4 96.5 73.6 96.5 64.8Z" fill="#FFF"/><circle cx="56" cy="58" r="5.5" fill="#1C1C1C"/><circle cx="74" cy="58" r="5.5" fill="#1C1C1C"/></svg>`
  );

const SOLFLARE_ICON =
  'data:image/svg+xml;base64,' +
  btoa(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none"><rect width="128" height="128" rx="28" fill="#FC7227"/><path d="M64 22L96 54L64 86L32 54L64 22Z" fill="#FFF"/><path d="M64 56L88 80L64 104L40 80L64 56Z" fill="#FFE0CC"/></svg>`
  );

const METAMASK_ICON =
  'data:image/svg+xml;base64,' +
  btoa(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none"><rect width="128" height="128" rx="28" fill="#F6851B"/><path d="M98 28L68 50L74 34L98 28Z" fill="#E2761B"/><path d="M30 28L59 50.5L54 34L30 28Z" fill="#E4761B"/><path d="M64 44L92 68L64 98L36 68L64 44Z" fill="#FFF"/></svg>`
  );

const BACKPACK_ICON =
  'data:image/svg+xml;base64,' +
  btoa(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none"><rect width="128" height="128" rx="28" fill="#E33E3F"/><rect x="38" y="36" width="52" height="60" rx="14" fill="#FFF"/><rect x="50" y="24" width="28" height="14" rx="6" fill="#FFF"/></svg>`
  );

const TRUST_ICON =
  'data:image/svg+xml;base64,' +
  btoa(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none"><rect width="128" height="128" rx="28" fill="#0500FF"/><path d="M64 24C76 34 90 36 96 36C96 72 82 92 64 104C46 92 32 72 32 36C38 36 52 34 64 24Z" stroke="#FFF" stroke-width="10" fill="none"/></svg>`
  );

const COINBASE_ICON =
  'data:image/svg+xml;base64,' +
  btoa(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none"><rect width="128" height="128" rx="28" fill="#0052FF"/><circle cx="64" cy="64" r="34" fill="#FFF"/><rect x="52" y="52" width="24" height="24" rx="4" fill="#0052FF"/></svg>`
  );

const OKX_ICON =
  'data:image/svg+xml;base64,' +
  btoa(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none"><rect width="128" height="128" rx="28" fill="#000"/><rect x="30" y="30" width="22" height="22" fill="#FFF"/><rect x="76" y="30" width="22" height="22" fill="#FFF"/><rect x="53" y="53" width="22" height="22" fill="#FFF"/><rect x="30" y="76" width="22" height="22" fill="#FFF"/><rect x="76" y="76" width="22" height="22" fill="#FFF"/></svg>`
  );

export class BearbyStandardWallet {
  readonly version = '1.0.0' as const;
  readonly name: string;
  readonly icon: string;
  readonly chains = SOLANA_CHAINS;

  readonly #provider: BearbySolanaProvider;
  readonly #listeners: Set<StandardChangeListener> = new Set();

  constructor(provider: BearbySolanaProvider, name: string, icon: string) {
    this.#provider = provider;
    this.name = name;
    this.icon = icon;

    this.#provider.onStandardChange(() => {
      this.#emitChange();
    });
  }

  get accounts(): readonly StandardWalletAccount[] {
    if (!this.#provider.isConnected || !this.#provider.publicKey) {
      return [];
    }
    return [
      {
        address: this.#provider.publicKey.toBase58(),
        publicKey: this.#provider.publicKey.toBytes(),
        chains: SOLANA_CHAINS,
        features: SOLANA_FEATURES,
        label: this.name,
        icon: this.icon,
      },
    ];
  }

  get features(): Record<string, unknown> {
    return {
      'standard:connect': {
        version: '1.0.0',
        connect: this.#connect,
      },
      'standard:disconnect': {
        version: '1.0.0',
        disconnect: this.#disconnect,
      },
      'standard:events': {
        version: '1.0.0',
        on: this.#on,
      },
      'solana:signAndSendTransaction': {
        version: '1.0.0',
        supportedTransactionVersions: ['legacy', 0] as const,
        signAndSendTransaction: this.#signAndSendTransaction,
      },
      'solana:signTransaction': {
        version: '1.0.0',
        supportedTransactionVersions: ['legacy', 0] as const,
        signTransaction: this.#signTransaction,
      },
      'solana:signMessage': {
        version: '1.0.0',
        signMessage: this.#signMessage,
      },
      'solana:signIn': {
        version: '1.0.0',
        signIn: this.#signIn,
      },
    };
  }

  #emitChange(): void {
    const props: StandardChangeProperties = {
      accounts: this.accounts,
      chains: this.chains,
      features: this.features,
    };
    this.#listeners.forEach((listener) => {
      try {
        listener(props);
      } catch (err) {
        console.error('Error in Wallet Standard event listener:', err);
      }
    });
  }

  #connect = async (input?: { silent?: boolean }): Promise<{ accounts: readonly StandardWalletAccount[] }> => {
    if (this.accounts.length > 0) {
      return { accounts: this.accounts };
    }
    try {
      await this.#provider.connect({ onlyIfTrusted: Boolean(input?.silent) });
    } catch (err) {
      if (input?.silent) {
        return { accounts: [] };
      }
      throw err;
    }
    return { accounts: this.accounts };
  };

  #disconnect = async (): Promise<void> => {
    await this.#provider.disconnect();
  };

  #on = (event: string, listener: StandardChangeListener): (() => void) => {
    if (event !== 'change') {
      return () => {};
    }
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  #signAndSendTransaction = async (
    ...inputs: Array<{
      transaction: Uint8Array;
      account: StandardWalletAccount;
      chain?: string;
      options?: Record<string, any>;
    }>
  ): Promise<Array<{ signature: Uint8Array }>> => {
    const outputs: Array<{ signature: Uint8Array }> = [];
    for (const input of inputs) {
      const txBytes = ensureUint8Array(input.transaction);
      const { signature } = await this.#provider.signAndSendTransaction(txBytes, input.options);
      outputs.push({
        signature: base58Decode(signature),
      });
    }
    return outputs;
  };

  #signTransaction = async (
    ...inputs: Array<{
      transaction: Uint8Array;
      account: StandardWalletAccount;
      chain?: string;
      options?: Record<string, any>;
    }>
  ): Promise<Array<{ signedTransaction: Uint8Array }>> => {
    if (inputs.length > 1) {
      const txList = inputs.map((item) => ensureUint8Array(item.transaction));
      const signedList = await this.#provider.signAllTransactions(txList);
      return signedList.map((signedTransaction) => ({ signedTransaction }));
    }

    const outputs: Array<{ signedTransaction: Uint8Array }> = [];
    for (const input of inputs) {
      const txBytes = ensureUint8Array(input.transaction);
      const { signedWireBytes } = await this.#provider.signTransactionBytes(txBytes, input.options);
      outputs.push({
        signedTransaction: signedWireBytes,
      });
    }
    return outputs;
  };

  #signMessage = async (
    ...inputs: Array<{
      message: Uint8Array;
      account: StandardWalletAccount;
    }>
  ): Promise<
    Array<{
      signedMessage: Uint8Array;
      signature: Uint8Array;
      signatureType: 'ed25519';
    }>
  > => {
    const outputs: Array<{
      signedMessage: Uint8Array;
      signature: Uint8Array;
      signatureType: 'ed25519';
    }> = [];

    for (const input of inputs) {
      const msgBytes = ensureUint8Array(input.message);
      const { signature, signedMessage } = await this.#provider.signMessage(msgBytes);
      outputs.push({
        signedMessage: signedMessage ?? msgBytes,
        signature,
        signatureType: 'ed25519',
      });
    }
    return outputs;
  };

  #signIn = async (
    ...inputs: SolanaSignInInput[]
  ): Promise<
    Array<{
      account: StandardWalletAccount;
      signedMessage: Uint8Array;
      signature: Uint8Array;
      signatureType: 'ed25519';
    }>
  > => {
    const list = inputs.length > 0 ? inputs : [{}];
    const outputs: Array<{
      account: StandardWalletAccount;
      signedMessage: Uint8Array;
      signature: Uint8Array;
      signatureType: 'ed25519';
    }> = [];

    for (const input of list) {
      const result = await this.#provider.signIn(input);
      outputs.push({
        account: {
          ...result.account,
          label: this.name,
          icon: this.icon,
        },
        signedMessage: result.signedMessage,
        signature: result.signature,
        signatureType: 'ed25519',
      });
    }
    return outputs;
  };
}

class RegisterWalletEvent extends Event {
  readonly #detail: (api: { register: (...wallets: any[]) => () => void }) => void;

  constructor(callback: (api: { register: (...wallets: any[]) => () => void }) => void) {
    super('wallet-standard:register-wallet', {
      bubbles: false,
      cancelable: false,
      composed: false,
    });
    this.#detail = callback;
  }

  get detail() {
    return this.#detail;
  }

  get type() {
    return 'wallet-standard:register-wallet' as const;
  }
}

export function registerWalletStandard(wallet: BearbyStandardWallet): void {
  if (typeof window === 'undefined') return;

  const callback = ({ register }: { register: (...wallets: any[]) => () => void }) => {
    return register(wallet);
  };

  try {
    window.dispatchEvent(new RegisterWalletEvent(callback));
  } catch (error) {
    console.error('wallet-standard:register-wallet event could not be dispatched', error);
  }

  try {
    window.addEventListener('wallet-standard:app-ready', ({ detail: api }: any) => {
      if (api && typeof api.register === 'function') {
        callback(api);
      }
    });
  } catch (error) {
    console.error('wallet-standard:app-ready event listener could not be added', error);
  }
}

export function registerSolanaStandardWallets(solanaProvider: BearbySolanaProvider): BearbyStandardWallet[] {
  const bearbyIcon = getBearbyIcon();

  const definitions: Array<{ name: string; icon: string }> = [
    { name: 'Bearby Wallet', icon: bearbyIcon },
    { name: 'Phantom', icon: PHANTOM_ICON },
    { name: 'Solflare', icon: SOLFLARE_ICON },
    { name: 'MetaMask', icon: METAMASK_ICON },
    { name: 'Backpack', icon: BACKPACK_ICON },
    { name: 'Trust', icon: TRUST_ICON },
    { name: 'Coinbase Wallet', icon: COINBASE_ICON },
    { name: 'OKX Wallet', icon: OKX_ICON },
  ];

  const wallets = definitions.map((def) => new BearbyStandardWallet(solanaProvider, def.name, def.icon));
  for (const wallet of wallets) {
    registerWalletStandard(wallet);
  }
  return wallets;
}

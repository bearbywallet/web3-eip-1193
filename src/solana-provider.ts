import type { BearbyProvider } from './types';
import {
  SolanaPublicKey,
  applySignedWireToTransactionObject,
  base58Decode,
  bytesToHex,
  createSignInMessageText,
  ensureUint8Array,
  extractSolanaMessageBytes,
  hexToBytes,
  injectSignatureIntoWireTransaction,
  serializeSolanaTransaction,
  type SolanaSignInInput,
} from './solana-utils';

export type SolanaEventCallback = (...args: any[]) => void;

export const SOLANA_CHAINS = [
  'solana:mainnet',
  'solana:devnet',
  'solana:testnet',
] as const;

export const SOLANA_FEATURES = [
  'solana:signAndSendTransaction',
  'solana:signTransaction',
  'solana:signMessage',
  'solana:signIn',
] as const;

export class BearbySolanaProvider {
  readonly isBearby: boolean = true;
  readonly isZilPay: boolean = true;
  readonly isPhantom: boolean = true;
  readonly isSolflare: boolean = true;
  readonly isBackpack: boolean = true;
  readonly isTrust: boolean = true;
  readonly isTrustWallet: boolean = true;
  readonly isCoinbaseWallet: boolean = true;
  readonly isMetaMask: boolean = true;
  readonly isOkxWallet: boolean = true;

  isConnected: boolean = false;
  publicKey: SolanaPublicKey | null = null;

  readonly #bridge: BearbyProvider;
  readonly #listeners: Map<string, Set<SolanaEventCallback>> = new Map();
  readonly #standardChangeListeners: Set<() => void> = new Set();

  constructor(bridge: BearbyProvider) {
    this.#bridge = bridge;
  }

  onStandardChange(listener: () => void): () => void {
    this.#standardChangeListeners.add(listener);
    return () => {
      this.#standardChangeListeners.delete(listener);
    };
  }

  #notifyStandardChange(): void {
    this.#standardChangeListeners.forEach((cb) => {
      try {
        cb();
      } catch (err) {
        console.error('Error in Solana standard change listener:', err);
      }
    });
  }

  handleAccountChanged(addressOrAccounts: string | string[] | null | undefined): void {
    const raw = Array.isArray(addressOrAccounts) ? addressOrAccounts[0] : addressOrAccounts;
    if (!raw || typeof raw !== 'string' || raw.startsWith('0x')) {
      if (raw === null || (Array.isArray(addressOrAccounts) && addressOrAccounts.length === 0)) {
        this.publicKey = null;
        this.isConnected = false;
        this.emit('disconnect');
        this.emit('accountChanged', null);
        this.#notifyStandardChange();
      }
      return;
    }

    try {
      const nextKey = new SolanaPublicKey(raw);
      if (nextKey.byteLength !== 32) return;
      const changed = !this.publicKey || !this.publicKey.equals(nextKey);
      this.publicKey = nextKey;
      this.isConnected = true;
      if (changed) {
        this.emit('accountChanged', this.publicKey);
        this.#notifyStandardChange();
      }
    } catch {
      // Ignore non-Solana addresses
    }
  }

  handleDisconnect(): void {
    this.publicKey = null;
    this.isConnected = false;
    this.emit('disconnect');
    this.#notifyStandardChange();
  }

  async connect(options?: { onlyIfTrusted?: boolean; silent?: boolean }): Promise<{ publicKey: SolanaPublicKey }> {
    const onlyIfTrusted = Boolean(options?.onlyIfTrusted || options?.silent);
    const result = await this.#bridge.request({
      method: 'solana_connect',
      params: [{ onlyIfTrusted }],
    });

    const address =
      typeof result === 'string'
        ? result
        : Array.isArray(result)
          ? result[0]
          : (result as any)?.publicKey || (result as any)?.address;

    if (!address || typeof address !== 'string') {
      throw {
        message: 'Failed to connect Solana account',
        code: 4001,
      };
    }

    this.publicKey = new SolanaPublicKey(address);
    this.isConnected = true;
    this.emit('connect', this.publicKey);
    this.#notifyStandardChange();

    return { publicKey: this.publicKey };
  }

  async disconnect(): Promise<void> {
    try {
      await this.#bridge.request({
        method: 'solana_disconnect',
        params: [],
      });
    } catch {
      // Ignore backend disconnect errors
    }
    this.handleDisconnect();
  }

  async signTransactionBytes(
    wireBytes: Uint8Array,
    options?: Record<string, any>
  ): Promise<{ signedWireBytes: Uint8Array; signatureBytes: Uint8Array }> {
    const messageBytes = extractSolanaMessageBytes(wireBytes);
    const response = (await this.#bridge.request({
      method: 'solana_signTransaction',
      params: [
        {
          transaction: bytesToHex(messageBytes),
          options: options || {},
        },
      ],
    })) as any;

    if (response?.signedTransaction && typeof response.signedTransaction === 'string') {
      const signedWireBytes = hexToBytes(response.signedTransaction);
      const sigBytes = response?.signature
        ? this.#decodeSignature(response.signature)
        : signedWireBytes.slice(1, 65);
      return { signedWireBytes, signatureBytes: sigBytes };
    }

    const rawSig = typeof response === 'string' ? response : response?.signature;
    if (!rawSig || typeof rawSig !== 'string') {
      throw new Error('Invalid signature response from wallet');
    }

    const signatureBytes = this.#decodeSignature(rawSig);
    let signerPubkeyBytes = this.publicKey?.toBytes();
    if (!signerPubkeyBytes && response?.publicKey) {
      try {
        signerPubkeyBytes = new SolanaPublicKey(response.publicKey).toBytes();
      } catch {
        // ignore
      }
    }

    const signedWireBytes = injectSignatureIntoWireTransaction(
      wireBytes,
      signatureBytes,
      signerPubkeyBytes,
      response?.message
    );

    return { signedWireBytes, signatureBytes };
  }

  async signTransaction<T>(transaction: T, options?: Record<string, any>): Promise<T> {
    const wireBytes = serializeSolanaTransaction(transaction);
    const { signedWireBytes, signatureBytes } = await this.signTransactionBytes(wireBytes, options);
    return applySignedWireToTransactionObject(transaction, signedWireBytes, signatureBytes, this.publicKey);
  }

  async signAllTransactions<T>(transactions: T[]): Promise<T[]> {
    if (!Array.isArray(transactions) || transactions.length === 0) {
      return [];
    }

    const wireBytesList = transactions.map((tx) => serializeSolanaTransaction(tx));
    const response = (await this.#bridge.request({
      method: 'solana_signAllTransactions',
      params: [
        {
          transactions: wireBytesList.map((b) => bytesToHex(extractSolanaMessageBytes(b))),
        },
      ],
    })) as any;

    const results: any[] = Array.isArray(response)
      ? response
      : Array.isArray(response?.transactions)
        ? response.transactions
        : [];

    if (results.length !== transactions.length) {
      throw new Error('Mismatched signed transactions count');
    }

    return transactions.map((tx, idx) => {
      const item = results[idx];
      const rawSig = typeof item === 'string' ? item : item?.signature;
      const signatureBytes = this.#decodeSignature(rawSig);
      const signedWireBytes = item?.signedTransaction
        ? hexToBytes(item.signedTransaction)
        : injectSignatureIntoWireTransaction(
            wireBytesList[idx],
            signatureBytes,
            this.publicKey?.toBytes(),
            item?.message
          );
      return applySignedWireToTransactionObject(tx, signedWireBytes, signatureBytes, this.publicKey);
    });
  }

  async signAndSendTransaction<T>(
    transaction: T,
    options?: Record<string, any>
  ): Promise<{ signature: string; publicKey?: SolanaPublicKey }> {
    const wireBytes = serializeSolanaTransaction(transaction);
    const messageBytes = extractSolanaMessageBytes(wireBytes);
    const response = (await this.#bridge.request({
      method: 'solana_signAndSendTransaction',
      params: [
        {
          transaction: bytesToHex(messageBytes),
          options: options || {},
        },
      ],
    })) as any;

    const signature = typeof response === 'string' ? response : response?.signature;
    if (!signature || typeof signature !== 'string') {
      throw new Error('Failed to obtain transaction signature');
    }

    return {
      signature,
      publicKey: this.publicKey ?? undefined,
    };
  }

  async signMessage(
    message: Uint8Array | string,
    display?: string
  ): Promise<{ signature: Uint8Array; publicKey: SolanaPublicKey }> {
    const msgBytes = ensureUint8Array(message);
    const response = (await this.#bridge.request({
      method: 'solana_signMessage',
      params: [
        {
          message: bytesToHex(msgBytes),
          display: display || 'utf8',
        },
      ],
    })) as any;

    const rawSig = typeof response === 'string' ? response : response?.signature;
    if (!rawSig || typeof rawSig !== 'string') {
      throw new Error('Failed to sign Solana message');
    }

    const signature = this.#decodeSignature(rawSig);
    if (!this.publicKey && response?.publicKey) {
      this.publicKey = new SolanaPublicKey(response.publicKey);
      this.isConnected = true;
    }

    const pubKey = this.publicKey ?? new SolanaPublicKey(new Uint8Array(32));
    return {
      signature,
      publicKey: pubKey,
    };
  }

  async signIn(input?: SolanaSignInInput): Promise<{
    account: {
      address: string;
      publicKey: Uint8Array;
      chains: readonly string[];
      features: readonly string[];
    };
    signedMessage: Uint8Array;
    signature: Uint8Array;
    signatureType: 'ed25519';
  }> {
    if (!this.publicKey) {
      await this.connect();
    }

    const address = this.publicKey!.toBase58();
    const domain =
      typeof window !== 'undefined' && window.location?.host
        ? window.location.host
        : 'localhost';

    const messageText = createSignInMessageText(input || {}, address, domain);
    const signedMessage = new TextEncoder().encode(messageText);
    const { signature } = await this.signMessage(signedMessage, 'utf8');

    return {
      account: {
        address,
        publicKey: this.publicKey!.toBytes(),
        chains: SOLANA_CHAINS,
        features: SOLANA_FEATURES,
      },
      signedMessage,
      signature,
      signatureType: 'ed25519',
    };
  }

  async request(payload: { method: string; params?: any }): Promise<any> {
    if (!payload || typeof payload.method !== 'string') {
      throw new Error('Invalid request payload');
    }

    const params = payload.params;
    switch (payload.method) {
      case 'connect':
        return this.connect(Array.isArray(params) ? params[0] : params);
      case 'disconnect':
        return this.disconnect();
      case 'signTransaction': {
        const tx = Array.isArray(params) ? params[0] : params?.transaction ?? params;
        const options = Array.isArray(params) ? params[1] : params?.options;
        return this.signTransaction(tx, options);
      }
      case 'signAllTransactions': {
        const txs = Array.isArray(params) ? params[0] ?? params : params?.transactions ?? params;
        return this.signAllTransactions(txs);
      }
      case 'signAndSendTransaction': {
        const tx = Array.isArray(params) ? params[0] : params?.transaction ?? params;
        const options = Array.isArray(params) ? params[1] : params?.options;
        return this.signAndSendTransaction(tx, options);
      }
      case 'signMessage': {
        const msg = Array.isArray(params) ? params[0] : params?.message ?? params;
        const display = Array.isArray(params) ? params[1] : params?.display;
        return this.signMessage(msg, display);
      }
      case 'signIn': {
        const input = Array.isArray(params) ? params[0] : params;
        return this.signIn(input);
      }
      default:
        return this.#bridge.request(payload);
    }
  }

  on(event: string, callback: SolanaEventCallback): this {
    if (!this.#listeners.has(event)) {
      this.#listeners.set(event, new Set());
    }
    this.#listeners.get(event)!.add(callback);
    return this;
  }

  addListener(event: string, callback: SolanaEventCallback): this {
    return this.on(event, callback);
  }

  off(event: string, callback: SolanaEventCallback): this {
    this.#listeners.get(event)?.delete(callback);
    return this;
  }

  removeListener(event: string, callback: SolanaEventCallback): this {
    return this.off(event, callback);
  }

  removeAllListeners(event?: string): this {
    if (event) {
      this.#listeners.delete(event);
    } else {
      this.#listeners.clear();
    }
    return this;
  }

  emit(event: string, ...args: any[]): boolean {
    const callbacks = this.#listeners.get(event);
    if (!callbacks || callbacks.size === 0) return false;
    callbacks.forEach((cb) => {
      try {
        cb(...args);
      } catch (e) {
        console.error(`Error in Solana ${event} listener:`, e);
      }
    });
    return true;
  }

  #decodeSignature(rawSig: string): Uint8Array {
    const clean = rawSig.startsWith('0x') || rawSig.startsWith('0X') ? rawSig.slice(2) : rawSig;
    if (clean.length === 128 && /^[0-9a-fA-F]+$/.test(clean)) {
      return hexToBytes(clean);
    }
    return base58Decode(rawSig);
  }
}

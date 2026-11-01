import { describe, expect, test } from 'bun:test';
import {
  BearbySolanaProvider,
  BearbyStandardWallet,
  SolanaPublicKey,
  base58Decode,
  base58Encode,
  bytesToHex,
  createSignInMessageText,
  hexToBytes,
  injectSignatureIntoWireTransaction,
} from '../index';
import type { BearbyProvider, RequestPayload } from '../src/types';

function createMockBridge(handler: (payload: RequestPayload) => Promise<any>): BearbyProvider {
  return {
    isBearby: true,
    isMetaMask: true,
    isCoinbaseWallet: true,
    isZilPay: true,
    request: handler,
    on: () => {},
    removeListener: () => {},
    isConnected: () => true,
  };
}

describe('Solana utils & PublicKey', () => {
  test('base58 encode/decode round-trip and SolanaPublicKey methods', () => {
    const raw = new Uint8Array(32);
    for (let i = 0; i < 32; i++) raw[i] = i + 1;

    const encoded = base58Encode(raw);
    const decoded = base58Decode(encoded);
    expect(Array.from(decoded)).toEqual(Array.from(raw));

    const pubKey = new SolanaPublicKey(encoded);
    expect(pubKey.toBase58()).toBe(encoded);
    expect(pubKey.toString()).toBe(encoded);
    expect(Array.from(pubKey.toBytes())).toEqual(Array.from(raw));
    expect(pubKey.equals(new SolanaPublicKey(raw))).toBe(true);
  });

  test('injectSignatureIntoWireTransaction preserves co-signatures in multi-signer v0 tx', () => {
    const signer0 = new Uint8Array(32).fill(0x11);
    const signer1 = new Uint8Array(32).fill(0x22); // Our wallet is slot 1
    const existingSig0 = new Uint8Array(64).fill(0xaa);
    const emptySig1 = new Uint8Array(64).fill(0x00);
    const ourSig1 = new Uint8Array(64).fill(0xbb);

    // v0 message: [0x80, numRequiredSignatures=2, 0, 0, numKeys=2, ...signer0, ...signer1, ...rest]
    const message = new Uint8Array(5 + 64 + 4);
    message[0] = 0x80;
    message[1] = 2;
    message[2] = 0;
    message[3] = 0;
    message[4] = 2;
    message.set(signer0, 5);
    message.set(signer1, 5 + 32);
    message.set([1, 2, 3, 4], 5 + 64);

    // Full wire tx: [2, ...existingSig0, ...emptySig1, ...message]
    const wire = new Uint8Array(1 + 128 + message.length);
    wire[0] = 2;
    wire.set(existingSig0, 1);
    wire.set(emptySig1, 1 + 64);
    wire.set(message, 1 + 128);

    const signed = injectSignatureIntoWireTransaction(
      wire,
      ourSig1,
      signer1,
      bytesToHex(message)
    );

    expect(signed[0]).toBe(2);
    // Slot 0 co-signature is preserved
    expect(Array.from(signed.slice(1, 65))).toEqual(Array.from(existingSig0));
    // Slot 1 has our signature
    expect(Array.from(signed.slice(65, 129))).toEqual(Array.from(ourSig1));
    // Message bytes intact
    expect(Array.from(signed.slice(129))).toEqual(Array.from(message));
  });
});

describe('BearbySolanaProvider & BearbyStandardWallet', () => {
  const samplePubkeyBytes = new Uint8Array(32).fill(7);
  const sampleAddress = base58Encode(samplePubkeyBytes);
  const sampleSigBytes = new Uint8Array(64).fill(9);
  const sampleSigHex = bytesToHex(sampleSigBytes);
  const sampleSigBase58 = base58Encode(sampleSigBytes);

  test('Wallet Standard connect, signMessage, signTransaction, signAndSendTransaction, signIn', async () => {
    const bridge = createMockBridge(async ({ method, params }) => {
      switch (method) {
        case 'solana_connect':
          return { publicKey: sampleAddress };
        case 'solana_disconnect':
          return true;
        case 'solana_signMessage':
          return { signature: sampleSigHex, publicKey: sampleAddress };
        case 'solana_signTransaction': {
          const msgHex = (params as any)[0].transaction as string;
          return {
            signature: sampleSigHex,
            message: msgHex,
            publicKey: sampleAddress,
          };
        }
        case 'solana_signAndSendTransaction':
          return { signature: sampleSigBase58 };
        default:
          throw new Error(`Unexpected method ${method}`);
      }
    });

    const solanaProvider = new BearbySolanaProvider(bridge);
    const phantomWallet = new BearbyStandardWallet(solanaProvider, 'Phantom', 'data:image/svg+xml;base64,');

    expect(phantomWallet.name).toBe('Phantom');
    expect(phantomWallet.accounts.length).toBe(0);

    // 1. standard:connect
    const connectFeature = phantomWallet.features['standard:connect'] as any;
    const { accounts } = await connectFeature.connect();
    expect(accounts.length).toBe(1);
    expect(accounts[0].address).toBe(sampleAddress);
    expect(Array.from(accounts[0].publicKey)).toEqual(Array.from(samplePubkeyBytes));
    expect(solanaProvider.isConnected).toBe(true);

    // 2. solana:signMessage
    const signMsgFeature = phantomWallet.features['solana:signMessage'] as any;
    const msgInput = new TextEncoder().encode('Hello Solana');
    const [msgOut] = await signMsgFeature.signMessage({
      message: msgInput,
      account: accounts[0],
    });
    expect(Array.from(msgOut.signature)).toEqual(Array.from(sampleSigBytes));
    expect(Array.from(msgOut.signedMessage)).toEqual(Array.from(msgInput));

    // 3. solana:signTransaction
    const signTxFeature = phantomWallet.features['solana:signTransaction'] as any;
    const msgBytes = new Uint8Array(3 + 1 + 32);
    msgBytes[0] = 1;
    msgBytes[3] = 1;
    msgBytes.set(samplePubkeyBytes, 4);
    const unsignedWire = new Uint8Array(1 + 64 + msgBytes.length);
    unsignedWire[0] = 1;
    unsignedWire.set(msgBytes, 65);

    const [txOut] = await signTxFeature.signTransaction({
      transaction: unsignedWire,
      account: accounts[0],
    });
    expect(Array.from(txOut.signedTransaction.slice(1, 65))).toEqual(Array.from(sampleSigBytes));

    // 4. solana:signAndSendTransaction
    const signSendFeature = phantomWallet.features['solana:signAndSendTransaction'] as any;
    const [sendOut] = await signSendFeature.signAndSendTransaction({
      transaction: unsignedWire,
      account: accounts[0],
    });
    expect(Array.from(sendOut.signature)).toEqual(Array.from(sampleSigBytes));

    // 5. solana:signIn
    const signInFeature = phantomWallet.features['solana:signIn'] as any;
    const [signInOut] = await signInFeature.signIn({
      domain: 'jup.ag',
      statement: 'Sign in to Jupiter',
      nonce: '123456',
    });
    expect(signInOut.account.address).toBe(sampleAddress);
    expect(Array.from(signInOut.signature)).toEqual(Array.from(sampleSigBytes));
    const expectedText = createSignInMessageText(
      { domain: 'jup.ag', statement: 'Sign in to Jupiter', nonce: '123456' },
      sampleAddress,
      'jup.ag'
    );
    expect(new TextDecoder().decode(signInOut.signedMessage)).toBe(expectedText);
  });
});

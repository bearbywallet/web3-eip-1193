export interface RequestPayload {
  method: string;
  params?: Array<any> | Record<string, any>;
}

export interface ProviderRpcError extends Error {
  message: string;
  code: number;
  data?: any;
}

export interface ProviderConnectInfo {
  readonly chainId: string;
}

export interface ProviderMessage {
  readonly type: string;
  readonly data: unknown;
}

export interface EthSubscription extends ProviderMessage {
  readonly type: 'eth_subscription';
  readonly data: {
    readonly subscription: string;
    readonly result: unknown;
  };
}

export interface BearbyProvider {
  readonly isZilPay: boolean;
  readonly isMetaMask: boolean;
  readonly isBearby: boolean;
  request(payload: RequestPayload): Promise<any>;
  on(event: 'connect', callback: (info: ProviderConnectInfo) => void): void;
  on(event: 'disconnect', callback: (error: ProviderRpcError) => void): void;
  on(event: 'chainChanged', callback: (chainId: string) => void): void;
  on(event: 'accountsChanged', callback: (accounts: string[]) => void): void;
  on(event: 'message', callback: (message: ProviderMessage) => void): void;
  removeListener(event: 'connect', callback: (info: ProviderConnectInfo) => void): void;
  removeListener(event: 'disconnect', callback: (error: ProviderRpcError) => void): void;
  removeListener(event: 'chainChanged', callback: (chainId: string) => void): void;
  removeListener(event: 'accountsChanged', callback: (accounts: string[]) => void): void;
  removeListener(event: 'message', callback: (message: ProviderMessage) => void): void;
  enable(): Promise<string[]>;
}

export interface BearbyEventData {
  event: string;
  data: ProviderConnectInfo | ProviderRpcError | string | string[] | ProviderMessage;
}

export interface BearbyResponseData {
  type: string;
  uuid: string;
  payload: {
    error?: ProviderRpcError;
    result: unknown
  };
}

export interface MetaData {
  description: string | null;
  title: string | null;
  colors: {
    primary?: string;
    secondary?: string;
    background?: string;
    text?: string;
  } | null;
}

export interface EIP6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

export interface EIP6963ProviderDetail {
  info: EIP6963ProviderInfo;
  provider: BearbyProvider;
}

export interface EIP6963RequestProviderEvent extends Event {
  type: "eip6963:requestProvider";
}

export interface EIP6963AnnounceProviderEvent extends CustomEvent {
  type: "eip6963:announceProvider";
  detail: EIP6963ProviderDetail;
}

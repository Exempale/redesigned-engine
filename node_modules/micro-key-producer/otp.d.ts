export type OTPOpts = {
    algorithm: string;
    digits: number;
    interval: number;
    secret: Uint8Array;
};
export declare function parse(otp: string): OTPOpts;
export declare function buildURL(opts: OTPOpts): string;
export declare function hotp(opts: OTPOpts, counter: number | bigint): string;
export declare function totp(opts: OTPOpts, ts?: number): string;
//# sourceMappingURL=otp.d.ts.map
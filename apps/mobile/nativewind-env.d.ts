/// <reference types="nativewind/types" />

// TypeScript 6 rejects side-effect imports of modules it cannot resolve
// (TS2882). global.css is consumed by Metro/NativeWind at build time, not by
// tsc, so it needs an ambient declaration.
declare module '*.css';

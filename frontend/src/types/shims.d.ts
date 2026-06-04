// Module shims to quiet editor type errors for packages without types
declare module 'sonner';
declare module 'lucide-react';
declare module '@tanstack/react-start';
declare module '@tanstack/react-start/server';
declare module 'tesseract.js';
declare module 'vaul';
declare module 'cmdk';
declare module 'input-otp';
declare module 'react-resizable-panels';
declare module 'embla-carousel-react';
declare module 'recharts';

// Fallback for any other unknown module imports
declare module '*';

// Minimal `process.env` typing for browser/server access in code
declare var process: {
  env: { [key: string]: string | undefined };
};

export {};

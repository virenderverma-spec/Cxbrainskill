import './globals.css';

export const metadata = {
  title: 'Meow Mobile — Customer Health Dashboard',
  description: 'Real-time customer health monitoring with journey tracking',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="bg-dark-bg min-h-screen">{children}</body>
    </html>
  );
}

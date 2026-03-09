"use client";

interface HeaderProps {
  title: string;
  action?: React.ReactNode;
}

export default function Header({ title, action }: HeaderProps) {
  return (
    <header className="h-16 border-b border-slate-200 bg-white/80 backdrop-blur-md flex items-center justify-between px-8 sticky top-0 z-10">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="flex items-center gap-4">
        {action}
      </div>
    </header>
  );
}

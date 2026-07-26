import React from 'react';

export interface LiquidGlassButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  active?: boolean;
}

export function LiquidGlassButton({ children, active, className = '', ...props }: LiquidGlassButtonProps) {
  return (
    <button
      {...props}
      className={`
        relative overflow-hidden inline-flex items-center justify-center gap-1.5
        px-2.5 py-1 sm:px-3 sm:py-1.25 rounded-full
        backdrop-blur-md
        bg-white/[0.04] hover:bg-white/[0.08]
        border border-white/10 hover:border-white/20
        shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12),_0_2px_6px_rgba(0,0,0,0.15)]
        text-white font-mono uppercase tracking-wider text-[9px] sm:text-[10px]
        transition-all duration-200 ease-out
        active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed
        ${active ? 'bg-white/15 border-white/30 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.25),_0_0_12px_rgba(255,255,255,0.08)] font-bold text-white' : ''}
        ${className}
      `}
    >
      <div className="relative z-10 flex items-center justify-center gap-1.5">
        {children}
      </div>
      {/* Crisp top rim shine for liquid glass feel */}
      <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/30 to-transparent pointer-events-none" />
      {/* Specular highlight at the top */}
      <div className="absolute top-0 left-0 right-0 h-1/2 bg-gradient-to-b from-white/[0.06] to-transparent pointer-events-none rounded-t-full" />
    </button>
  );
}


const base = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };

export const Logo = ({ size = 26 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <rect width="32" height="32" rx="7" fill="var(--accent)" />
    <path d="M5 17h6l3-7 4 13 3-6h6" fill="none" stroke="var(--accent-ink)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
export const OverviewIcon = () => (<svg {...base}><path d="M3 12h4l3-8 4 16 3-8h4" /></svg>);
export const ErrorsIcon = () => (<svg {...base}><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>);
export const LogsIcon = () => (<svg {...base}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>);
export const SetupIcon = () => (<svg {...base}><path d="m16 18 6-6-6-6M8 6l-6 6 6 6" /></svg>);
export const CheckIcon = (p) => (<svg {...base} {...p}><path d="M20 6 9 17l-5-5" /></svg>);
export const AlertIcon = (p) => (<svg {...base} {...p}><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></svg>);
export const SlowIcon = (p) => (<svg {...base} {...p}><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2M9 2h6" /></svg>);
export const IdleIcon = (p) => (<svg {...base} {...p}><circle cx="12" cy="12" r="9" /><path d="M8 12h8" /></svg>);
export const Chevron = (p) => (<svg {...base} width={16} height={16} {...p}><path d="m9 18 6-6-6-6" /></svg>);
export const CopyIcon = () => (<svg {...base} width={16} height={16}><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>);

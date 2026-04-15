import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

export function TypeScriptLogo(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <rect width="24" height="24" rx="3" fill="#3178C6" />
      <path d="M5.5 12.5h5v1.2H9.2v5.3H7.8v-5.3H5.5v-1.2zm7.2 0h2.4l.1.7c.5-.5 1.2-.9 2-.9 1.5 0 2.3 1 2.3 2.6V19h-1.4v-3.9c0-1-.4-1.6-1.2-1.6-.7 0-1.2.3-1.6.8l-.2.4V19h-1.4v-6.5z" fill="white" />
    </svg>
  );
}

export function GoLogo(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M1.8 10.5c-.1 0-.1-.1 0-.1l.6-.5c.1 0 .1-.1.2 0h3.4s.1.1 0 .1l-.5.5c-.1.1-.2.1-.2.1l-3.5-.1zm-1.1 1.2c-.1 0-.1-.1 0-.2l.6-.5h4.2s.1.1 0 .2l-.2.4c0 .1-.1.1-.2.1H.7zm1.8 1.2c0 .1 0 .1-.1.1l-.3.5c0 .1 0 .1.1.1H5s.1 0 .1-.1l.1-.5c0-.1 0-.1-.1-.1H2.5z" fill="#00ACD7" />
      <path d="M16.1 10.1c-1.4.4-1.9.5-2.7.8-.2.1-.2.1-.3-.1-.2-.2-.3-.3-.5-.4-.9-.5-1.7-.3-2.5.3-1 .7-1.4 1.7-1.4 2.9 0 1.1.8 2 1.9 2.1 1 .1 1.7-.3 2.3-1.1.1-.2.2-.3.3-.5H11c-.3 0-.3-.2-.3-.3l.1-1c0-.2.1-.3.3-.3h3.9c.2 0 .3.1.3.3-.1.6-.1 1.1-.3 1.7-.4 1.1-1.1 1.9-2.1 2.5-.9.5-1.8.7-2.8.6-1-.1-1.8-.5-2.4-1.3-.5-.8-.7-1.7-.6-2.7.1-1.4.7-2.5 1.7-3.4 1-.8 2.1-1.2 3.4-1.1 1 .1 1.9.5 2.5 1.3.2.2.1.3-.1.4l-.5.3z" fill="#00ACD7" />
      <path d="M18.5 15.6c-.9-.1-1.6-.4-2.2-1-.5-.6-.8-1.2-.8-2 .1-1.3.6-2.3 1.5-3.1.9-.8 2-1.3 3.2-1.3 1 0 1.9.3 2.5 1.1.6.7.8 1.6.7 2.5-.1.3-.1.5-.1.7h-5.7c0 .9.7 1.4 1.5 1.5.7.1 1.3 0 1.8-.3.1-.1.2-.1.3 0l.7.9c.1.1 0 .2-.1.2-.8.6-1.7.8-2.7.8h-.6zm2.5-4.3c0-.7-.5-1.2-1.3-1.3-.8-.1-1.5.2-1.9.9l-.1.4h3.3z" fill="#00ACD7" />
    </svg>
  );
}

export function ReactLogo(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <circle cx="12" cy="12" r="2.2" fill="#61DAFB" />
      <g stroke="#61DAFB" strokeWidth="1" fill="none">
        <ellipse cx="12" cy="12" rx="10" ry="4" />
        <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)" />
        <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)" />
      </g>
    </svg>
  );
}

export function NextJsLogo(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <circle cx="12" cy="12" r="11" fill="currentColor" />
      <path d="M9.5 8v8l6.5-4-6.5-4z" fill="none" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M15.5 8v8" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function ReactNativeLogo(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <rect x="7" y="3" width="10" height="18" rx="2" stroke="#61DAFB" strokeWidth="1" fill="none" />
      <circle cx="12" cy="12" r="1.5" fill="#61DAFB" />
      <g stroke="#61DAFB" strokeWidth="0.7" fill="none">
        <ellipse cx="12" cy="12" rx="6" ry="2.5" />
        <ellipse cx="12" cy="12" rx="6" ry="2.5" transform="rotate(60 12 12)" />
        <ellipse cx="12" cy="12" rx="6" ry="2.5" transform="rotate(120 12 12)" />
      </g>
    </svg>
  );
}

export function NestJsLogo(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" fill="#E0234E" />
      <path d="M14.5 6.5c-.5 0-.9.2-1.2.5-.1-.8-.6-1.2-1.3-1.2-.3 0-.5.1-.7.2.1-.3.1-.5.1-.7 0-.4-.2-.7-.5-.8.8 0 1.4.6 1.4 1.3 0 .1 0 .3-.1.4.3-.3.6-.4 1-.4.7 0 1.3.5 1.3 1.2v.1c.5-.1.8.2.8.6 0 .4-.3.7-.7.7h-.1v4.3c0 1.5-1.1 2.8-2.5 3l-.3.1c-2 .3-3.8-1.1-4.1-3.1v-.1c-.1-.5 0-1 .2-1.5.1-.4.4-.7.7-.9.3-.2.7-.3 1-.2.4.1.7.3.9.6.2.3.3.7.2 1.1-.1.4-.3.7-.6.9-.3.2-.7.2-1 .1l-.2-.1c.1.6.4 1.1.9 1.5.7.5 1.5.6 2.3.4 1.3-.4 2.1-1.7 1.9-3l-.1-.7V8.1c0-.5-.2-1-.5-1.2-.3-.2-.7-.3-1-.2z" fill="white" />
    </svg>
  );
}

export function GinLogo(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M12 4L8 6v4l-4 2v4l4 2 4-2 4 2 4-2v-4l-4-2V6l-4-2z" stroke="#00ADD8" strokeWidth="1.2" fill="none" />
      <circle cx="12" cy="12" r="2" fill="#00ADD8" />
    </svg>
  );
}

export function AutoDetectIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 3l1.5 3.5 3.5.5-2.5 2.5.5 3.5L12 11l-3 2 .5-3.5L7 7l3.5-.5L12 3z" />
      <path d="M5 19l2-2m10 2l-2-2m-3 3v-3" />
    </svg>
  );
}

export const TECH_ICON_COMPONENTS: Record<string, React.ComponentType<IconProps>> = {
  typescript: TypeScriptLogo,
  go: GoLogo,
  react: ReactLogo,
  nextjs: NextJsLogo,
  'react-native': ReactNativeLogo,
  nestjs: NestJsLogo,
  gin: GinLogo,
};

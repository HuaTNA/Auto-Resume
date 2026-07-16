import type { ReactNode, SVGProps } from "react";

export type HuaIconProps = SVGProps<SVGSVGElement> & {
  size?: number | string;
};

function IconFrame({ children, size = 24, strokeWidth = 1.8, ...props }: HuaIconProps & { children: ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      aria-hidden={props["aria-label"] ? undefined : true}
      {...props}
    >
      {children}
    </svg>
  );
}

export function HuaMarkIcon(props: HuaIconProps) {
  return (
    <IconFrame {...props}>
      <path d="M7 3.5v17M3.5 8h7M7 8 3.6 14.2M7 8l3.6 5.2m3.6-8.7-2.1 4m2.2-3.3v6m3.9-6.7v6.2l2.3-1.4M13 15.6h8m-4-2.8v7.7" />
    </IconFrame>
  );
}

export function HuaHomeIcon(props: HuaIconProps) {
  return (
    <IconFrame {...props}>
      <path d="m3.5 11.3 8.5-7.5 8.5 7.5M5.5 10v9.3c0 .5.4.9.9.9h11.2c.5 0 .9-.4.9-.9V10M12 12.7v7.5m-2.5-5h5M12 15.2l-2.2 2.4m2.2-2.4 2.2 2.4" />
    </IconFrame>
  );
}

export function HuaCopilotIcon(props: HuaIconProps) {
  return (
    <IconFrame {...props}>
      <path d="M12 3.2c.5 3.5 2.3 5.3 5.8 5.8-3.5.5-5.3 2.3-5.8 5.8-.5-3.5-2.3-5.3-5.8-5.8 3.5-.5 5.3-2.3 5.8-5.8ZM5.2 14.2v6.6m-2.5-4.1h5m-2.5 0-2 2.1m2-2.1 2 2.1m11.5-4.3c.2 1.5 1 2.3 2.5 2.5-1.5.2-2.3 1-2.5 2.5-.2-1.5-1-2.3-2.5-2.5 1.5-.2 2.3-1 2.5-2.5Z" />
    </IconFrame>
  );
}

export function HuaCareerIcon(props: HuaIconProps) {
  return (
    <IconFrame {...props}>
      <path d="M8.5 7V5.8c0-1 .8-1.8 1.8-1.8h3.4c1 0 1.8.8 1.8 1.8V7M3 12.2h18M12 10v7.5m-2.3-3.3h4.6m-2.3 0-2 2m2-2 2 2" />
      <rect x="3" y="7" width="18" height="13.5" rx="2.5" />
    </IconFrame>
  );
}

export function HuaKnowledgeIcon(props: HuaIconProps) {
  return (
    <IconFrame {...props}>
      <path d="M12 6.5C10.2 4.8 7.5 4 4 4v13.5c3.5 0 6.2.8 8 2.5m0-13.5C13.8 4.8 16.5 4 20 4v13.5c-3.5 0-6.2.8-8 2.5m0-13.5V20M7 8.2h2.4M8.2 6.9v4.8m0-2.4-1.7 1.8m1.7-1.8 1.5 1.6" />
    </IconFrame>
  );
}

export function HuaAutomationIcon(props: HuaIconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="12" cy="4.5" r="2" />
      <circle cx="5" cy="18.5" r="2" />
      <circle cx="12" cy="18.5" r="2" />
      <circle cx="19" cy="18.5" r="2" />
      <path d="M12 6.5v5.2M5 16.5v-2.2c0-1.4 1.1-2.6 2.6-2.6h8.8c1.4 0 2.6 1.1 2.6 2.6v2.2m-7-4.8v4.8m0-4.8-2 2m2-2 2 2" />
    </IconFrame>
  );
}

export function HuaIntegrationsIcon(props: HuaIconProps) {
  return (
    <IconFrame {...props}>
      <path d="M8.5 3v4m-3-4v4M4 7h6v2.2c0 1.7-1.3 3-3 3s-3-1.3-3-3V7Zm3 5.2v2.3C7 15.9 8.1 17 9.5 17H12m3.5 4v-4m3 4v-4m1.5 0h-6v-2.2c0-1.7 1.3-3 3-3s3 1.3 3 3V17Zm-3-5.2V9.5C17 8.1 15.9 7 14.5 7H12m0-2v14m-2-10h4" />
    </IconFrame>
  );
}

export function HuaDocumentsIcon(props: HuaIconProps) {
  return (
    <IconFrame {...props}>
      <path d="M6 3h8l4 4v14H6c-.6 0-1-.4-1-1V4c0-.6.4-1 1-1Zm8 0v5h4M9 11.5h6m-6 4h6m-3-6v8m0-4-2 2m2-2 2 2" />
    </IconFrame>
  );
}

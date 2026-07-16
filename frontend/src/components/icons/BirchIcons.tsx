import Image, { type ImageProps } from "next/image";

export const BIRCH_ICON_NAMES = [
  "tree",
  "leaf",
  "grove",
  "bark",
  "catkin",
  "bud",
  "growth-ring",
  "branch",
  "winter",
  "root",
] as const;

export type BirchIconName = (typeof BIRCH_ICON_NAMES)[number];

interface BirchIconProps extends Omit<ImageProps, "src" | "width" | "height" | "alt"> {
  name: BirchIconName;
  size?: number;
  alt?: string;
}

export function BirchIcon({ name, size = 24, alt = "", ...props }: BirchIconProps) {
  return (
    <Image
      src={`/icons/birch/${name}.svg`}
      width={size}
      height={size}
      alt={alt}
      aria-hidden={alt ? undefined : true}
      unoptimized
      {...props}
    />
  );
}

type NamedBirchIconProps = Omit<BirchIconProps, "name">;

export const BirchTreeIcon = (props: NamedBirchIconProps) => <BirchIcon name="tree" {...props} />;
export const BirchLeafIcon = (props: NamedBirchIconProps) => <BirchIcon name="leaf" {...props} />;
export const BirchGroveIcon = (props: NamedBirchIconProps) => <BirchIcon name="grove" {...props} />;
export const BirchBarkIcon = (props: NamedBirchIconProps) => <BirchIcon name="bark" {...props} />;
export const BirchCatkinIcon = (props: NamedBirchIconProps) => <BirchIcon name="catkin" {...props} />;
export const BirchBudIcon = (props: NamedBirchIconProps) => <BirchIcon name="bud" {...props} />;
export const BirchGrowthRingIcon = (props: NamedBirchIconProps) => <BirchIcon name="growth-ring" {...props} />;
export const BirchBranchIcon = (props: NamedBirchIconProps) => <BirchIcon name="branch" {...props} />;
export const BirchWinterIcon = (props: NamedBirchIconProps) => <BirchIcon name="winter" {...props} />;
export const BirchRootIcon = (props: NamedBirchIconProps) => <BirchIcon name="root" {...props} />;

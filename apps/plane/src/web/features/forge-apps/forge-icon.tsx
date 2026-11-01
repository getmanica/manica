import type { SVGProps } from 'react'
import { type SimpleIcon, siGithub } from 'simple-icons'
import type { ForgeApp } from '@/features/forge-apps/forge-apps'

type IconProps = SVGProps<SVGSVGElement>

// A Simple Icons logo, in the current text colour.
const BrandIcon = ({ icon, ...props }: IconProps & { icon: SimpleIcon }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
    <path d={icon.path} />
  </svg>
)

export const GitHubIcon = (props: IconProps) => (
  <BrandIcon icon={siGithub} {...props} />
)

const icons: Record<ForgeApp['forge'], SimpleIcon> = {
  github: siGithub,
}

export const ForgeIcon = ({
  forge,
  ...props
}: IconProps & { forge: ForgeApp['forge'] }) => (
  <BrandIcon icon={icons[forge]} {...props} />
)

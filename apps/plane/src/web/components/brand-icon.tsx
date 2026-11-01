import type { SVGProps } from 'react'
import { type SimpleIcon, siGithub } from 'simple-icons'

export type IconProps = SVGProps<SVGSVGElement>

// A Simple Icons logo, in the current text colour.
export const BrandIcon = ({
  icon,
  ...props
}: IconProps & { icon: SimpleIcon }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
    <path d={icon.path} />
  </svg>
)

export const GitHubIcon = (props: IconProps) => (
  <BrandIcon icon={siGithub} {...props} />
)

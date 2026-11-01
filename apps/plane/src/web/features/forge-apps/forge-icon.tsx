import { type SimpleIcon, siGithub } from 'simple-icons'
import { BrandIcon, type IconProps } from '@/components/brand-icon'
import type { ForgeApp } from '@/features/forge-apps/forge-apps'

const icons: Record<ForgeApp['forge'], SimpleIcon> = {
  github: siGithub,
}

export const ForgeIcon = ({
  forge,
  ...props
}: IconProps & { forge: ForgeApp['forge'] }) => (
  <BrandIcon icon={icons[forge]} {...props} />
)

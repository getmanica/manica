import { Avatar, Style } from '@dicebear/core'
import glass from '@dicebear/styles/glass.json'
import notionists from '@dicebear/styles/notionists.json'

// DiceBear avatars, rendered locally so ids never leave the browser.

const userStyle = new Style(notionists)
const organizationStyle = new Style(glass)

export const userAvatar = (seed: string) =>
  new Avatar(userStyle, { seed }).toDataUri()

export const organizationAvatar = (seed: string) =>
  new Avatar(organizationStyle, { seed }).toDataUri()

import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { type Theme, themes, useTheme } from '@/lib/theme'

const themeLabels: Record<Theme, string> = {
  dark: 'Dark',
  light: 'Light',
  system: 'System',
}

export const Appearance = () => {
  const [theme, setTheme] = useTheme()
  return (
    <RadioGroup
      aria-label="Theme"
      // Controlled from the start: none is checked until the stored theme
      // is read, once mounted.
      value={theme ?? null}
      onValueChange={(value) => setTheme(value as Theme)}
      className="grid-cols-1 gap-3 sm:grid-cols-3"
    >
      {themes.map((option) => (
        // biome-ignore lint/a11y/noLabelWithoutControl: the radio renders inside
        <label
          key={option}
          className="flex cursor-pointer items-center gap-3 rounded-lg px-4 py-3 text-sm ring-1 ring-foreground/10 transition-colors hover:bg-muted/50 has-data-checked:ring-2 has-data-checked:ring-foreground/60"
        >
          <RadioGroupItem value={option} />
          {themeLabels[option]}
        </label>
      ))}
    </RadioGroup>
  )
}

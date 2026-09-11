import { Cpu, Download } from 'lucide-react'
import { toast } from 'sonner'
import DeviceAppearance from '../components/DeviceAppearance'
import PhysicalRotation from '../components/PhysicalRotation'
import { Eyebrow, Panel, SelectField, SettingRow, StatusDot } from '../components/page-ui'
import SerialConnection from '../components/SerialConnection'
import { Button } from '../components/ui/button'
import { Switch } from '../components/ui/switch'
import type { PageProps } from '../lib/studio'

export default function DeviceSettings({ snapshot: s, pending, save, action }: PageProps) {
  const settings = s.settings

  const exportSettings = () => {
    const blob = new Blob([`${JSON.stringify(settings, null, 2)}\n`], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'companion-settings.json'
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Settings exported')
  }

  return (
    <>
      <Panel className="hardware-card">
        <div className="hardware-summary">
          <span className="hardware-icon">
            <Cpu size={30} />
          </span>
          <div>
            <Eyebrow>Your companion</Eyebrow>
            <h2>{s.device.profile?.name || 'Waveshare AMOLED'}</h2>
            <p>
              {s.device.profile
                ? `${s.device.profile.display.width} x ${s.device.profile.display.height} ${s.device.profile.display.shape} display - ${s.device.profile.status}`
                : 'ESP32-S3 / 1.75-inch round touch display'}
            </p>
            <div className="hardware-status">
              <StatusDot state={s.device.status === 'connected' ? 'connected' : 'idle'} />
              {s.device.status === 'connected'
                ? 'Connected over USB'
                : s.device.status === 'disabled'
                  ? 'USB connection not configured'
                  : 'Waiting for your device'}
            </div>
          </div>
        </div>
        <SerialConnection snapshot={s} pending={pending} action={action} />
      </Panel>

      <Panel
        title="Device appearance"
        description="Colours for the companion, independent of the studio."
      >
        <DeviceAppearance snapshot={s} disabled={pending} save={save} />
      </Panel>

      <Panel title="Display" description="Small adjustments. A more comfortable companion.">
        <SettingRow
          title="Physical display rotation"
          description="Fine-tune the device angle. The playground stays upright."
        >
          <PhysicalRotation
            value={settings.device.rotation ?? 0}
            disabled={pending}
            onSave={(rotation) => save({ device: { rotation } })}
          />
        </SettingRow>
        <SettingRow title="Text spacing" description="The gap between status and session name.">
          <SelectField
            compact
            label="Text spacing"
            value={settings.device.textGap}
            disabled={pending}
            onChange={(value) => void save({ device: { textGap: Number(value) } })}
          >
            <option value={4}>Close</option>
            <option value={8}>Balanced</option>
            <option value={16}>Wide</option>
          </SelectField>
        </SettingRow>
        <SettingRow
          title="Follow your mouse"
          description="The face eases towards your cursor. Available on macOS."
        >
          <Switch
            aria-label="Follow your mouse"
            checked={settings.device.followMouse}
            disabled={pending || !s.pointer.supported}
            onCheckedChange={(value) => void save({ device: { followMouse: value } })}
          />
        </SettingRow>
        {settings.device.followMouse && (
          <SettingRow
            title="Mouse update interval"
            description="Smooth motion between each sampled position."
          >
            <SelectField
              compact
              label="Mouse update interval"
              value={settings.device.mouseInterval}
              disabled={pending}
              onChange={(value) => void save({ device: { mouseInterval: Number(value) } })}
            >
              {[100, 250, 500, 1000].map((n) => (
                <option key={n} value={n}>
                  {n === 1000 ? '1 second' : `${n} ms`}
                </option>
              ))}
            </SelectField>
          </SettingRow>
        )}

        {s.pointer.error && <p className="source-message">{s.pointer.error}</p>}
        <SettingRow
          title="Show module selector"
          description="Navigation buttons and page dots. Swiping works while hidden."
        >
          <Switch
            aria-label="Show module selector"
            checked={settings.device.showModuleNavigation ?? false}
            disabled={pending}
            onCheckedChange={(showModuleNavigation) =>
              void save({ device: { showModuleNavigation } })
            }
          />
        </SettingRow>
        <SettingRow
          title="Show card backgrounds"
          description="Subtle panels behind usage and HEY cards. Off uses the screen colour."
        >
          <Switch
            aria-label="Show card backgrounds"
            checked={settings.device.showCardBackgrounds ?? false}
            disabled={pending}
            onCheckedChange={(showCardBackgrounds) =>
              void save({ device: { showCardBackgrounds } })
            }
          />
        </SettingRow>
        <SettingRow title="Typography" description="Geist on the screen and throughout the studio.">
          <span className="font-specimen">
            Aa <small>Geist</small>
          </span>
        </SettingRow>
      </Panel>

      <Panel title="Studio preferences" description="Make this workspace your own.">
        <SettingRow title="Appearance" description="Choose a light, dark or system theme.">
          <SelectField
            compact
            label="Appearance"
            value={settings.appearance.theme}
            disabled={pending}
            onChange={(theme) => void save({ appearance: { theme } })}
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="system">System</option>
          </SelectField>
        </SettingRow>
        <SettingRow
          title="Reading direction"
          description="English starts left to right. Change it any time."
        >
          <SelectField
            compact
            label="Reading direction"
            value={settings.appearance.direction}
            disabled={pending}
            onChange={(direction) => void save({ appearance: { direction } })}
          >
            <option value="ltr">Left to right</option>
            <option value="rtl">Right to left</option>
          </SelectField>
        </SettingRow>
        <SettingRow
          title="Reduce preview motion"
          description="Still previews and quieter interface transitions."
        >
          <Switch
            aria-label="Reduce preview motion"
            checked={settings.appearance.reducedMotion}
            disabled={pending}
            onCheckedChange={(reducedMotion) => void save({ appearance: { reducedMotion } })}
          />
        </SettingRow>
      </Panel>

      <Panel
        title="Your configuration"
        description="Mappings, module order and preferences are saved on this computer."
      >
        <div className="export-row">
          <p>Take your settings with you.</p>
          <Button variant="outline" onClick={exportSettings}>
            <Download size={14} />
            Export settings
          </Button>
        </div>
      </Panel>
    </>
  )
}

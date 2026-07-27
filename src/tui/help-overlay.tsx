interface HelpColors {
  accent: string;
  border: string;
  text: string;
  dim: string;
}

const HELP_SECTIONS: ReadonlyArray<{
  title: string;
  keys: ReadonlyArray<readonly [string, string]>;
}> = [
  {
    title: "Navigate",
    keys: [
      ["up/down", "move selection"],
      ["tab", "switch pane (identities / tools / folders)"],
      ["r", "refresh the dashboard"],
    ],
  },
  {
    title: "Edit the draft",
    keys: [
      ["space / enter", "enable or disable the selected tool"],
      ["n", "cycle the VPN profile"],
      ["v", "cycle the execution VM"],
      ["m", "make the selected identity the default"],
      ["b", "bind a folder to the selected identity"],
      ["x", "unbind the selected folder"],
    ],
  },
  {
    title: "Review changes",
    keys: [
      ["s", "review staged changes and save"],
      ["u", "discard the draft"],
    ],
  },
  {
    title: "Screens",
    keys: [
      ["h", "rollback history"],
      ["a", "auth health (redacted)"],
      ["p", "team policy"],
      ["g", "plugins"],
      ["k", "secrets"],
    ],
  },
  {
    title: "Session",
    keys: [
      ["e", "edit the registry in $EDITOR"],
      ["d", "run doctor and exit"],
      ["q / esc", "quit"],
      ["?", "toggle this overview"],
    ],
  },
];

const KEY_COLUMN_WIDTH = 15;

/** Full keymap overview, opened with `?` from any TUI screen. */
export function HelpOverlay({ colors }: { colors: HelpColors }) {
  return (
    <box
      title="Keys"
      style={{
        flexGrow: 1,
        margin: 1,
        border: true,
        borderColor: colors.accent,
        padding: 1,
        flexDirection: "column",
      }}
    >
      <scrollbox focused={false} style={{ flexGrow: 1 }}>
        {HELP_SECTIONS.map((section, index) => (
          <box key={section.title} style={{ flexDirection: "column" }}>
            {index > 0 && <text> </text>}
            <text fg={colors.accent}>{section.title}</text>
            {section.keys.map(([key, description]) => (
              <text key={key} fg={colors.text}>
                {`  ${key.padEnd(KEY_COLUMN_WIDTH)}`}
                <span fg={colors.dim}>{description}</span>
              </text>
            ))}
          </box>
        ))}
      </scrollbox>
    </box>
  );
}

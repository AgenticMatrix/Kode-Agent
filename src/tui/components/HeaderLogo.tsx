import { Box, Text } from 'ink';

const CADUCEUS_ART = [
  '               ················',
  '             ··●●●●●●●●●●●●●··',
  '           ··●●●●●●●●●●●●●●··   ',
  '         ·●●●●●●●●●●●●●●●··     ',
  '       ··●●●●●●●●●●●●●●··       ',
  '      ··●●●●●●●●●●●●●··          ',
  '     ··●●●●●●●●●●●●●●●●··        ',
  '     ··●●●●●●●●●●●●●●●●●●●●●··   ',
  '            ··●●●●●●●●●●●●●●●··   ',
  '               ··●●●●●●●●●●··     ',
  '              ··●●●●●●●●●··       ',
  '              ··●●●●●●●●··        ',
  '             ··●●●●●●··           ',
  '            ··●●●●··              ',
  '           ··●●··                 ',
  '           ····                    ',
];

export function HeaderLogo() {
  const logoLines = CADUCEUS_ART;
  const artMaxLen = Math.max(...logoLines.map((l) => l.length));

  const Kw = ({ children }: { children: string }) => (
    <Text bold color="grey">{children}</Text>
  );

  const Dim = ({ children }: { children: string }) => (
    <Text dimColor color="grey">{children}</Text>
  );

  const rightPanel: { text: string; render: (pad: number) => React.ReactNode }[] = [
    {
      text: 'Coder Agent v0.1.0',
      render: (pad) => (
        <Text>
          <Kw>Coder Agent</Kw>
          <Text color="white"> v0.1.0{' '.repeat(pad)}</Text>
        </Text>
      ),
    },
    { text: '', render: (pad) => <Text>{' '.repeat(pad)}</Text> },
    {
      text: 'tools: 33',
      render: (pad) => (
        <Text>
          <Kw>tools:</Kw>
          <Text color="white"> 33{' '.repeat(pad)}</Text>
        </Text>
      ),
    },
    {
      text: '  File Operations: Read / Write / Edit',
      render: (pad) => (
        <Text>
          <Dim>  File Operations:</Dim>
          <Text color="white"> Read / Write / Edit{' '.repeat(pad)}</Text>
        </Text>
      ),
    },
    {
      text: '  Terminal: Bash',
      render: (pad) => (
        <Text>
          <Dim>  Terminal:</Dim>
          <Text color="white"> Bash{' '.repeat(pad)}</Text>
        </Text>
      ),
    },
    {
      text: '  Agent: Explore / Plan / general-purpose',
      render: (pad) => (
        <Text>
          <Dim>  Agent:</Dim>
          <Text color="white"> Explore / Plan / general-purpose{' '.repeat(pad)}</Text>
        </Text>
      ),
    },
    {
      text: '  Task Management: TaskCreate / TaskUpdate / TaskList / TaskGet',
      render: (pad) => (
        <Text>
          <Dim>  Task Management:</Dim>
          <Text color="white"> TaskCreate / TaskUpdate / TaskList / TaskGet{' '.repeat(pad)}</Text>
        </Text>
      ),
    },
    { text: '', render: (pad) => <Text>{' '.repeat(pad)}</Text> },
    {
      text: 'skills: 2',
      render: (pad) => (
        <Text>
          <Kw>skills:</Kw>
          <Text color="white"> 2{' '.repeat(pad)}</Text>
        </Text>
      ),
    },
    {
      text: '  - kimi-webbridge: interact with websites via real browser',
      render: (pad) => (
        <Text>
          <Dim>  - kimi-webbridge</Dim>
          <Text color="white">: interact with websites via real browser{' '.repeat(pad)}</Text>
        </Text>
      ),
    },
    {
      text: '  - update-config: configure Claude Code harness settings',
      render: (pad) => (
        <Text>
          <Dim>  - update-config</Dim>
          <Text color="white">: configure Claude Code harness settings{' '.repeat(pad)}</Text>
        </Text>
      ),
    },
    { text: '', render: (pad) => <Text>{' '.repeat(pad)}</Text> },
    {
      text: `workspace: ${process.cwd()}`,
      render: (pad) => (
        <Text>
          <Kw>workspace:</Kw>
          <Text color="white"> {process.cwd()}{' '.repeat(pad)}</Text>
        </Text>
      ),
    },
  ];

  const rightMaxLen = Math.max(...rightPanel.map((r) => r.text.length));

  const artDashLen = artMaxLen + 2;
  const rightDashLen = rightMaxLen + 2;
  const topBorder = `┌${'─'.repeat(artDashLen)}┬${'─'.repeat(rightDashLen)}┐`;
  const botBorder = `└${'─'.repeat(artDashLen)}┴${'─'.repeat(rightDashLen)}┘`;

  const renderLine = (lineIdx: number): React.ReactNode => {
    const artLine = lineIdx < logoLines.length ? logoLines[lineIdx] : '';
    const artPadded = artLine.padEnd(artMaxLen);

    const rightEntry = rightPanel[lineIdx];
    const rightJsx = rightEntry
      ? rightEntry.render(rightMaxLen - rightEntry.text.length)
      : <Text color="white">{' '.repeat(rightMaxLen)}</Text>;

    return (
      <Text key={lineIdx}>
        <Text color="grey">│ </Text>
        <Text color="#AB47BC">{artPadded}</Text>
        <Text color="grey"> │ </Text>
        {rightJsx}
        <Text color="grey"> │</Text>
      </Text>
    );
  };

  const totalLines = Math.max(logoLines.length, rightPanel.length);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color="grey">{topBorder}</Text>
      {Array.from({ length: totalLines }, (_, i) => renderLine(i))}
      <Text color="grey">{botBorder}</Text>
    </Box>
  );
}

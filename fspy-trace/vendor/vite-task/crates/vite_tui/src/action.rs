#[expect(unused, reason = "TUI actions defined for future use")]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Action {
    Tick,
    Render,
    Resize(u16, u16),
    Suspend,
    Resume,
    Quit,
    ClearScreen,
    Error(Box<str>),
    Task { task: Box<str>, bytes: Box<[u8]> },
    Up,
    Down,
    SelectTask(usize),
}

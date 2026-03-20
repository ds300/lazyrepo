#[derive(Debug, Clone, Copy)]
pub struct ScreenSize {
    pub rows: u16,
    pub cols: u16,
}

#[derive(Debug, Clone, Copy)]
pub struct CursorPosition {
    pub rows: u16,
    pub cols: u16,
}

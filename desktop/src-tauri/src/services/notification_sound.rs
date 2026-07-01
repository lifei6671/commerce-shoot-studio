use std::process::Command;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NotificationSound {
    Clear,
    Soft,
    Success,
    Viral,
}

#[derive(Debug)]
pub enum NotificationSoundError {
    UnsupportedSound(String),
    UnsupportedPlatform,
    Io(std::io::Error),
    PlayerFailed,
}

impl std::fmt::Display for NotificationSoundError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            NotificationSoundError::UnsupportedSound(sound_id) => {
                write!(formatter, "不支持的提示音：{sound_id}")
            }
            NotificationSoundError::UnsupportedPlatform => {
                write!(formatter, "当前平台暂不支持原生提示音")
            }
            NotificationSoundError::Io(source) => write!(formatter, "播放提示音失败：{source}"),
            NotificationSoundError::PlayerFailed => write!(formatter, "播放提示音失败"),
        }
    }
}

impl std::error::Error for NotificationSoundError {}

impl From<std::io::Error> for NotificationSoundError {
    fn from(source: std::io::Error) -> Self {
        NotificationSoundError::Io(source)
    }
}

impl TryFrom<&str> for NotificationSound {
    type Error = NotificationSoundError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "clear" => Ok(NotificationSound::Clear),
            "soft" => Ok(NotificationSound::Soft),
            "success" => Ok(NotificationSound::Success),
            "viral" => Ok(NotificationSound::Viral),
            _ => Err(NotificationSoundError::UnsupportedSound(value.to_string())),
        }
    }
}

pub fn play_notification_sound(sound_id: &str) -> Result<(), NotificationSoundError> {
    let sound = NotificationSound::try_from(sound_id)?;
    play_native_sound(sound)
}

#[cfg(target_os = "macos")]
fn play_native_sound(sound: NotificationSound) -> Result<(), NotificationSoundError> {
    let file_name = match sound {
        NotificationSound::Clear => "Glass.aiff",
        NotificationSound::Soft => "Ping.aiff",
        NotificationSound::Success => "Hero.aiff",
        NotificationSound::Viral => "Funk.aiff",
    };
    let status = Command::new("/usr/bin/afplay")
        .arg(format!("/System/Library/Sounds/{file_name}"))
        .status()?;
    if status.success() {
        Ok(())
    } else {
        Err(NotificationSoundError::PlayerFailed)
    }
}

#[cfg(target_os = "windows")]
fn play_native_sound(sound: NotificationSound) -> Result<(), NotificationSoundError> {
    let notes = match sound {
        NotificationSound::Clear => &[(880, 120), (1320, 120)][..],
        NotificationSound::Soft => &[(523, 160), (659, 180)][..],
        NotificationSound::Success => &[(659, 100), (784, 120), (1047, 160)][..],
        NotificationSound::Viral => &[(988, 90), (1319, 90), (1760, 120), (1175, 110)][..],
    };
    let script = notes
        .iter()
        .map(|(frequency, duration)| format!("[Console]::Beep({frequency},{duration})"))
        .collect::<Vec<_>>()
        .join(";");
    let status = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .status()?;
    if status.success() {
        Ok(())
    } else {
        Err(NotificationSoundError::PlayerFailed)
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn play_native_sound(_sound: NotificationSound) -> Result<(), NotificationSoundError> {
    Err(NotificationSoundError::UnsupportedPlatform)
}

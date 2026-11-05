//! The `/settings` bodies (fs.md "Server settings"): the keys of `config.toml` that apply
//! without a restart. Errors are `ErrorBody`.

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use ts_rs::TS;

/// `GET /settings`, and `POST /settings`' answer: the running config's values, `null`
/// where the file has no key and the default applies.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ServerSettings {
    /// `[]` skips nothing; `null` is the default.
    pub search_skip: Option<Vec<String>>,
    pub uploads_dir: Option<String>,
    /// The file differs from what is running: edited by hand since it was loaded.
    pub file_changed: bool,
    pub defaults: SettingsDefaults,
}

/// The daemon's own defaults, so the client keeps no copy.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SettingsDefaults {
    pub search_skip: Vec<String>,
    pub uploads_dir: String,
}

/// `POST /settings`: a field left out is unchanged, `null` removes the key, a value sets
/// it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SettingsChange {
    #[serde(default, skip_serializing_if = "Patch::is_keep")]
    #[ts(optional, type = "Array<string> | null")]
    pub search_skip: Patch<Vec<String>>,
    #[serde(default, skip_serializing_if = "Patch::is_keep")]
    #[ts(optional, type = "string | null")]
    pub uploads_dir: Patch<String>,
}

/// One field of a change: left out, `null`, or a value.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum Patch<T> {
    #[default]
    Keep,
    Remove,
    Set(T),
}

impl<T> Patch<T> {
    pub fn is_keep(&self) -> bool {
        matches!(self, Self::Keep)
    }
}

impl<'de, T: Deserialize<'de>> Deserialize<'de> for Patch<T> {
    /// Only for a field that is there: a left-out one is `Keep` by `default`.
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Ok(match Option::<T>::deserialize(deserializer)? {
            None => Self::Remove,
            Some(value) => Self::Set(value),
        })
    }
}

impl<T: Serialize> Serialize for Patch<T> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Keep | Self::Remove => serializer.serialize_none(),
            Self::Set(value) => value.serialize(serializer),
        }
    }
}

/// `POST /settings/reload`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Reloaded {
    pub settings: ServerSettings,
    /// Keys that changed in the file but apply only at a restart, as `tmux.socket_name`.
    pub restart_needed: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_change_tells_left_out_from_null() {
        let parse = |json| serde_json::from_str::<SettingsChange>(json);
        assert_eq!(parse("{}").expect("parses"), SettingsChange::default());
        let change = parse(r#"{"searchSkip":null,"uploadsDir":"~/up"}"#).expect("parses");
        assert_eq!(
            (change.search_skip, change.uploads_dir),
            (Patch::Remove, Patch::Set("~/up".to_owned()))
        );
        assert!(parse(r#"{"favorites":[]}"#).is_err());
    }
}

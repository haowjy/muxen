# muxen shell integration for zsh 5.1+ (docs/design/complete.md#the-shell-snippet).
#
# Marks the prompt and the command line with OSC 133, so muxen's suggestion strip can
# read what you are typing. Source it at the
# END of ~/.zshrc, after your prompt theme and plugins:
#
#   [[ -r ~/gitrepos/muxen/contrib/shell/muxen.zsh ]] && source ~/gitrepos/muxen/contrib/shell/muxen.zsh
#
# It also sets INC_APPEND_HISTORY, so muxen suggests commands from the shells still
# open (zsh saves history only with HISTFILE and SAVEHIST set). Set
# MUXEN_NO_HISTORY_APPEND=1 before sourcing to leave history options alone.

[[ -o interactive ]] || return 0
(( ${+__muxen_loaded} )) && return 0
typeset -g __muxen_loaded=1

[[ -n ${MUXEN_NO_HISTORY_APPEND-} ]] || setopt INC_APPEND_HISTORY

# First precmd hook: D closes the last command with its status, A opens the prompt.
__muxen_precmd() {
  local s=$?
  printf '\e]133;D;%s\a\e]133;A\a' "$s"
  return $s
}

# Last precmd hook: B ends the prompt, where typed input starts. Re-added each time,
# since prompt themes rebuild PS1 in their own hooks.
__muxen_prompt() {
  local s=$?
  [[ $PS1 == *$'%{\e]133;B\a%}' ]] || PS1+=$'%{\e]133;B\a%}'
  return $s
}

# C: the command line was accepted and output starts.
__muxen_preexec() {
  printf '\e]133;C\a'
}

precmd_functions=(__muxen_precmd ${precmd_functions[@]} __muxen_prompt)
preexec_functions+=(__muxen_preexec)

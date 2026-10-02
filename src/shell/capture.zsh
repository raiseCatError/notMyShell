#!/bin/zsh

zmodload zsh/zpty || { echo 'error: missing module zsh/zpty' >&2; exit 1 }
zmodload zsh/datetime || exit 1
typeset -F deadline=$(( EPOCHREALTIME + 1.5 ))
export NMSH_CAPTURE_DELIMITER="nmsh-capture-$$-$RANDOM-$RANDOM"
nmsh_capture_cleanup() {
    if [[ -n $NMSH_CAPTURE_ROOT && -f $NMSH_CAPTURE_ROOT/pid ]]; then
        local pid=$(< $NMSH_CAPTURE_ROOT/pid)
        [[ $pid == <-> && $pid -gt 1 ]] && kill -KILL -- -$pid 2>/dev/null
    fi
    zpty -d z 2>/dev/null
    [[ -n $NMSH_CAPTURE_ROOT ]] && command rm -rf -- "$NMSH_CAPTURE_ROOT"
}
trap nmsh_capture_cleanup EXIT
trap 'exit 2' TERM HUP INT

# spawn shell
zpty -b z exec zsh -f -i

# line buffer for pty output
local line

setopt rcquotes
() {
    if [[ -n $NMSH_CAPTURE_ROOT ]]; then
        zpty -w z "print -r -- \$\$ > ${(q)NMSH_CAPTURE_ROOT}/pid; source ${(q)1}"
    else
        zpty -w z source $1
    fi
    while (( EPOCHREALTIME < deadline )) && zpty -t z; do
        if zpty -r z line; then
            [[ $line == ok* || $line == *$'\nok'* ]] && return
        else
            sleep 0.005
        fi
    done
    echo 'error initializing.' >&2
    exit 2
} =( <<< '
# no prompt!
PROMPT=

# load completion system
autoload compinit
compinit -d ~/.zcompdump_capture

# never run a command
bindkey ''^M'' undefined
bindkey ''^J'' undefined
bindkey ''^I'' complete-word

# Printable framing survives nonblocking zpty reads (which truncate NUL chunks).
null-line () {
    print -r -- "$NMSH_CAPTURE_DELIMITER"
}
compprefuncs=( null-line )
comppostfuncs=( null-line exit )

# never group stuff!
zstyle '':completion:*'' list-grouped false
# don''t insert tab when attempting completion on empty line
zstyle '':completion:*'' insert-tab false
# no list separator, this saves some stripping later on
zstyle '':completion:*'' list-separator ''''

# we use zparseopts
zmodload zsh/zutil

# override compadd (this our hook)
compadd () {

    # check if any of -O, -A or -D are given
    if [[ ${@[1,(i)(-|--)]} == *-(O|A|D)\ * ]]; then
        # if that is the case, just delegate and leave
        builtin compadd "$@"
        return $?
    fi

    # ok, this concerns us!
    # echo -E - got this: "$@"

    # be careful with namespacing here, we don''t want to mess with stuff that
    # should be passed to compadd!
    typeset -a __hits __dscr __tmp

    # do we have a description parameter?
    # note we don''t use zparseopts here because of combined option parameters
    # with arguments like -default- confuse it.
    if (( $@[(I)-d] )); then # kind of a hack, $+@[(r)-d] doesn''t work because of line noise overload
        # next param after -d
        __tmp=${@[$[${@[(i)-d]}+1]]}
        # description can be given as an array parameter name, or inline () array
        if [[ $__tmp == \(* ]]; then
            eval "__dscr=$__tmp"
        else
            __dscr=( "${(@P)__tmp}" )
        fi
    fi

    # capture completions by injecting -A parameter into the compadd call.
    # this takes care of matching for us.
    builtin compadd -A __hits -D __dscr "$@"

    # JESUS CHRIST IT TOOK ME FOREVER TO FIGURE OUT THIS OPTION WAS SET AND WAS MESSING WITH MY SHIT HERE
    setopt localoptions norcexpandparam extendedglob

    # extract prefixes and suffixes from compadd call. we can''t do zsh''s cool
    # -r remove-func magic, but it''s better than nothing.
    typeset -A apre hpre hsuf asuf
    zparseopts -E P:=apre p:=hpre S:=asuf s:=hsuf

    # append / to directories? we are only emulating -f in a half-assed way
    # here, but it''s better than nothing.
    integer dirsuf=0
    # don''t be fooled by -default- >.>
    if [[ -z $hsuf && "${${@//-default-/}% -# *}" == *-[[:alnum:]]#f* ]]; then
        dirsuf=1
    fi

    # just drop
    [[ -n $__hits ]] || return

    # this is the point where we have all matches in $__hits and all
    # descriptions in $__dscr!

    # display all matches
    local dsuf dscr
    for i in {1..$#__hits}; do

        # add a dir suffix?
        (( dirsuf )) && [[ -d $__hits[$i] ]] && dsuf=/ || dsuf=
        # description to be displayed afterwards
        (( $#__dscr >= $i )) && dscr=" -- ${${__dscr[$i]}##$__hits[$i] #}" || dscr=

        echo -E - $IPREFIX$apre$hpre$__hits[$i]$dsuf$hsuf$asuf$dscr

    done

}

# signal success!
echo ok')

zpty -w z "$*"$'\t'

integer tog=0
# read from the pty, and parse linewise
while (( EPOCHREALTIME < deadline )) && zpty -t z; do
    if zpty -r z line; then print -rn -- "$line"; else sleep 0.005; fi
done | while IFS= read -r line; do
    if [[ $line == *$NMSH_CAPTURE_DELIMITER$'\r' ]]; then
        (( tog++ )) && return 0 || continue
    fi
    # display between toggles
    (( tog )) && echo -E - $line
done

return 2

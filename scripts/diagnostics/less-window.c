// Diagnostic-only scheduling probe; never part of NMSh or a merge candidate.
#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdarg.h>
#include <signal.h>
#include <stdlib.h>
#include <sys/ioctl.h>
#include <unistd.h>
#include <errno.h>
static volatile sig_atomic_t armed, gated;
static void (*original_winch)(int);
static int notify_fd(void) { return atoi(getenv("PROBE_NOTIFY")); }
static void notify(char c) { syscall(1, notify_fd(), &c, 1); }
static void wrapped_winch(int sig) {
    original_winch(sig);
    if (gated) notify('W');
}
void (*signal(int sig, void (*handler)(int)))(int) {
    static void *(*real_signal)(int, void *) = NULL;
    if (!real_signal) real_signal = dlsym(RTLD_NEXT, "signal");
    if (sig == SIGWINCH && handler != SIG_IGN && handler != SIG_DFL) {
        original_winch = handler;
        return real_signal(sig, wrapped_winch);
    }
    return real_signal(sig, handler);
}
int ioctl(int fd, unsigned long request, ...) {
    static int (*real_ioctl)(int, unsigned long, void *) = NULL;
    if (!real_ioctl) real_ioctl = dlsym(RTLD_NEXT, "ioctl");
    va_list args; va_start(args, request); void *arg = va_arg(args, void *); va_end(args);
    int result = real_ioctl(fd, request, arg);
    if (request == TIOCGWINSZ && result == 0) {
        struct winsize *size = arg;
        if (size->ws_row == 31) armed = 1;
        if (size->ws_row == 35) notify('F');
    }
    return result;
}
ssize_t write(int fd, const void *buffer, size_t bytes) {
    static ssize_t (*real_write)(int, const void *, size_t) = NULL;
    if (!real_write) real_write = dlsym(RTLD_NEXT, "write");
    if (fd == STDOUT_FILENO && armed && !gated) {
        gated = 1;
        notify('G'); // less is flushing its intermediate repaint, before iread sets reading=1.
        char release;
        int input = atoi(getenv("PROBE_RELEASE"));
        while (read(input, &release, 1) < 0 && errno == EINTR) {}
    }
    return real_write(fd, buffer, bytes);
}

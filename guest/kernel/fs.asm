# ---------------------------------------------------------------------------
# TVFS: a tiny read-only filesystem on the virtio disk
#
# Sector 0 is a superblock:
#   0  magic "TVFS0001" (8 bytes)
#   8  version (u32)           = 1
#  12  sector size (u32)       = 512
#  16  total sectors (u32)
#  20  file count (u32)
#  24  table sector (u32)      = 1
#  28  data sector (u32)       = 2
# The file table lives in sectors 1..2; each entry is 64 bytes:
#   0..31 name (NUL padded), 32 size, 36 start sector, 40 flags
# ---------------------------------------------------------------------------

# Returns a0 = 1 when a filesystem was mounted.
fs_mount:
  addi sp, sp, -16
  sw ra, 12(sp)
  sw s0, 8(sp)

  la t0, virtio_ok
  lw t0, 0(t0)
  beqz t0, fs_mount_fail

  li a0, 0
  la a1, fs_super
  call virtio_read512
  bnez a0, fs_mount_fail

  la s0, fs_super
  lw t0, 0(s0)
  li t1, TVFS_MAGIC_LO
  bne t0, t1, fs_mount_fail
  lw t0, 4(s0)
  li t1, TVFS_MAGIC_HI
  bne t0, t1, fs_mount_fail
  lw t0, 8(s0)
  li t1, 1
  bne t0, t1, fs_mount_fail
  lw t0, 12(s0)
  li t1, 512
  bne t0, t1, fs_mount_fail
  lw t0, 20(s0)                 # file count
  li t1, TVFS_MAX_FILES
  bltu t1, t0, fs_mount_fail
  la t1, fs_count
  sw t0, 0(t1)

  li a0, 1
  la a1, fs_table
  call virtio_read512
  bnez a0, fs_mount_fail
  li a0, 2
  la a1, fs_table
  addi a1, a1, 512
  call virtio_read512
  bnez a0, fs_mount_fail

  la t0, fs_ok
  li t1, 1
  sw t1, 0(t0)
  li a0, 1
  lw s0, 8(sp)
  lw ra, 12(sp)
  addi sp, sp, 16
  ret

fs_mount_fail:
  la t0, fs_ok
  sw zero, 0(t0)
  li a0, 0
  lw s0, 8(sp)
  lw ra, 12(sp)
  addi sp, sp, 16
  ret

# a0 = name -> a0 = entry pointer or 0
fs_find:
  addi sp, sp, -32
  sw ra, 28(sp)
  sw s0, 24(sp)
  sw s1, 20(sp)
  sw s2, 16(sp)
  sw s3, 12(sp)
  mv s3, a0
  la t0, fs_ok
  lw t0, 0(t0)
  beqz t0, fs_find_none
  la s0, fs_table
  la t0, fs_count
  lw s1, 0(t0)
  li s2, 0
fs_find_loop:
  bgeu s2, s1, fs_find_none
  slli t0, s2, 6
  add t0, t0, s0
  lbu t1, 0(t0)
  beqz t1, fs_find_next
  mv a0, s3
  mv a1, t0
  call strcmp
  beqz a0, fs_find_hit
fs_find_next:
  addi s2, s2, 1
  j fs_find_loop
fs_find_hit:
  slli t0, s2, 6
  add a0, t0, s0
  j fs_find_done
fs_find_none:
  li a0, 0
fs_find_done:
  lw s3, 12(sp)
  lw s2, 16(sp)
  lw s1, 20(sp)
  lw s0, 24(sp)
  lw ra, 28(sp)
  addi sp, sp, 32
  ret

# a0 = entry, a1 = destination, a2 = max bytes
fs_read:
  li a3, 0
  j fs_read_part

# a0 = entry, a1 = dest, a2 = max, a3 = offset -> a0 = bytes copied (or -1)
fs_read_part:
  addi sp, sp, -64
  sw ra, 60(sp)
  sw s0, 56(sp)
  sw s1, 52(sp)
  sw s2, 48(sp)
  sw s3, 44(sp)
  sw s4, 40(sp)
  sw s5, 36(sp)
  sw s6, 32(sp)
  mv s0, a1                    # destination
  mv s1, a2                    # maximum
  mv s5, a3                    # offset
  lw s2, 32(a0)                # file size
  lw s3, 36(a0)                # first sector
  bgeu s5, s2, fs_read_zero
  sub s2, s2, s5               # remaining bytes
  bltu s2, s1, fs_read_len
  mv s2, s1
fs_read_len:
  li t0, 512
  divu t1, s5, t0
  add s3, s3, t1
  remu s4, s5, t0              # in-sector offset
  mv s1, s2                    # total to copy
  li s2, 0                     # copied
fs_read_loop:
  beq s2, s1, fs_read_done
  mv a0, s3
  la a1, disk_buf
  call virtio_read512
  bnez a0, fs_read_error
  li t0, 512
  sub t0, t0, s4
  sub t1, s1, s2
  bltu t0, t1, fs_read_chunk
  mv t0, t1
fs_read_chunk:
  mv s6, t0
  mv a0, s0
  la a1, disk_buf
  add a1, a1, s4
  mv a2, s6
  call memcpy
  add s0, s0, s6
  add s2, s2, s6
  addi s3, s3, 1
  li s4, 0
  j fs_read_loop
fs_read_done:
  mv a0, s2
  j fs_read_ret
fs_read_error:
  li a0, -1
  j fs_read_ret
fs_read_zero:
  li a0, 0
fs_read_ret:
  lw s6, 32(sp)
  lw s5, 36(sp)
  lw s4, 40(sp)
  lw s3, 44(sp)
  lw s2, 48(sp)
  lw s1, 52(sp)
  lw s0, 56(sp)
  lw ra, 60(sp)
  addi sp, sp, 64
  ret

# a0 = number of spaces
put_spaces:
  mv t2, a0
  blez t2, put_spaces_done
put_spaces_loop:
  li a0, 32
  EMIT_CHAR
  addi t2, t2, -1
  bgtz t2, put_spaces_loop
put_spaces_done:
  ret

# List the root directory.
fs_list:
  addi sp, sp, -32
  sw ra, 28(sp)
  sw s0, 24(sp)
  sw s1, 20(sp)
  sw s2, 16(sp)
  sw s3, 12(sp)
  la t0, fs_ok
  lw t0, 0(t0)
  beqz t0, fs_list_nodisk
  la s0, fs_table
  la t0, fs_count
  lw s1, 0(t0)
  li s2, 0
fs_list_loop:
  bgeu s2, s1, fs_list_done
  slli t0, s2, 6
  add s3, t0, s0
  lbu t0, 0(s3)
  beqz t0, fs_list_next
  mv a0, s3
  call puts
  mv a0, s3
  call strlen
  li t0, 18
  sub a0, t0, a0
  call put_spaces
  lw a0, 32(s3)
  call putdec
  PRINT_STR msg_bytes_nl
fs_list_next:
  addi s2, s2, 1
  j fs_list_loop
fs_list_done:
  PRINT_STR msg_total_files
  la t0, fs_count
  lw a0, 0(t0)
  call putdec
  NEWLINE
  j fs_list_ret
fs_list_nodisk:
  PRINT_STR msg_no_disk
fs_list_ret:
  lw s3, 12(sp)
  lw s2, 16(sp)
  lw s1, 20(sp)
  lw s0, 24(sp)
  lw ra, 28(sp)
  addi sp, sp, 32
  ret

# a0 = name; prints the file contents (returns a0 = 0 on success)
fs_cat:
  addi sp, sp, -48
  sw ra, 44(sp)
  sw s0, 40(sp)
  sw s1, 36(sp)
  sw s2, 32(sp)
  sw s3, 28(sp)
  sw s4, 24(sp)
  call fs_find
  beqz a0, fs_cat_not_found
  mv s0, a0
  lw s1, 32(s0)                # size
  lw s2, 36(s0)                # sector
  li s3, 0                     # copied
fs_cat_loop:
  beq s3, s1, fs_cat_done
  mv a0, s2
  la a1, disk_buf
  call virtio_read512
  bnez a0, fs_cat_error
  li t0, 512
  sub t1, s1, s3
  bltu t0, t1, fs_cat_chunk
  mv t0, t1
fs_cat_chunk:
  mv s4, t0
  li t2, 0
fs_cat_bytes:
  beq t2, s4, fs_cat_next
  la t3, disk_buf
  add t3, t3, t2
  lbu a0, 0(t3)
  EMIT_CHAR
  addi t2, t2, 1
  j fs_cat_bytes
fs_cat_next:
  add s3, s3, s4
  addi s2, s2, 1
  li s4, 0
  j fs_cat_loop
fs_cat_done:
  li a0, 0
  j fs_cat_ret
fs_cat_not_found:
  li a0, -1
  j fs_cat_ret
fs_cat_error:
  li a0, -2
fs_cat_ret:
  lw s4, 24(sp)
  lw s3, 28(sp)
  lw s2, 32(sp)
  lw s1, 36(sp)
  lw s0, 40(sp)
  lw ra, 44(sp)
  addi sp, sp, 48
  ret

# ---------------------------------------------------------------------------
# Minimal string and memory routines
# ---------------------------------------------------------------------------

# a0 = string -> a0 = length
strlen:
  mv t0, a0
strlen_loop:
  lbu t1, 0(t0)
  beqz t1, strlen_done
  addi t0, t0, 1
  j strlen_loop
strlen_done:
  sub a0, t0, a0
  ret

# a0 = s1, a1 = s2 -> a0 = 0 when equal, nonzero otherwise
strcmp:
strcmp_loop:
  lbu t0, 0(a0)
  lbu t1, 0(a1)
  bne t0, t1, strcmp_diff
  beqz t0, strcmp_equal
  addi a0, a0, 1
  addi a1, a1, 1
  j strcmp_loop
strcmp_diff:
  sub a0, t0, t1
  ret
strcmp_equal:
  li a0, 0
  ret

# a0 = s1, a1 = s2, a2 = n -> a0 = 0 when equal for n bytes
strncmp:
strncmp_loop:
  beqz a2, strncmp_equal
  lbu t0, 0(a0)
  lbu t1, 0(a1)
  bne t0, t1, strncmp_diff
  beqz t0, strncmp_equal
  addi a0, a0, 1
  addi a1, a1, 1
  addi a2, a2, -1
  j strncmp_loop
strncmp_diff:
  sub a0, t0, t1
  ret
strncmp_equal:
  li a0, 0
  ret

# a0 = dst, a1 = src, a2 = n
memcpy:
  mv t0, a0
memcpy_loop:
  beqz a2, memcpy_done
  lbu t1, 0(a1)
  sb t1, 0(t0)
  addi t0, t0, 1
  addi a1, a1, 1
  addi a2, a2, -1
  j memcpy_loop
memcpy_done:
  ret

# a0 = dst, a1 = value, a2 = n
memset:
  mv t0, a0
memset_loop:
  beqz a2, memset_done
  sb a1, 0(t0)
  addi t0, t0, 1
  addi a2, a2, -1
  j memset_loop
memset_done:
  ret

# a0 = first, a1 = second -> a0 = -1, 0 or 1 (unsigned lexicographic)
strcmp_ord:
strcmp_ord_loop:
  lbu t0, 0(a0)
  lbu t1, 0(a1)
  bne t0, t1, strcmp_ord_diff
  beqz t0, strcmp_ord_equal
  addi a0, a0, 1
  addi a1, a1, 1
  j strcmp_ord_loop
strcmp_ord_diff:
  bltu t0, t1, strcmp_ord_less
  li a0, 1
  ret
strcmp_ord_less:
  li a0, -1
  ret
strcmp_ord_equal:
  li a0, 0
  ret

# a0 = string, a1 = first char -> a0 = pointer past the char or 0
skip_char:
  lbu t0, 0(a0)
  bne t0, a1, skip_char_none
  addi a0, a0, 1
  ret
skip_char_none:
  li a0, 0
  ret

# a0 = string -> a0 = number of leading chars that are not spaces
token_len:
  mv t0, a0
token_len_loop:
  lbu t1, 0(t0)
  beqz t1, token_len_done
  li t2, 32
  beq t1, t2, token_len_done
  addi t0, t0, 1
  j token_len_loop
token_len_done:
  sub a0, t0, a0
  ret

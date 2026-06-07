/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

/**
 * Tree-sitter grammar for Zutai general mode (.zt) — v0 spec.
 *
 * Known limitations:
 *  - Numeric literals do not include a leading minus sign.
 *    `f -1` is parsed as subtraction, not application of -1.
 *    Write `f (-1)` or `f (0 - 1)` as a workaround.
 *  - Hyphenated field names (e.g. target-triple) are only recognised
 *    after `.` or `?.`; inside record literals, use plain identifiers.
 *    Access via cfg.target-triple highlights correctly.
 */
module.exports = grammar({
  name: 'zutai',

  extras: $ => [/\s+/],

  word: $ => $.identifier,

  // GLR disambiguation: an empty `{}` after `match expr` could be the match body
  // or a record literal passed as an argument.  Declaring the conflict lets the
  // parser try both paths; only the match-body path completes a valid match_expr.
  conflicts: $ => [
    [$.record, $.match_expr],
    [$.record, $.func_block],
  ],

  rules: {
    source_file: $ => repeat(choice($.declaration, $._expr)),

    // ══════════════════════════════════════════════════════════════
    // Declarations
    // ══════════════════════════════════════════════════════════════

    declaration: $ => choice(
      // name := expr
      prec(2, seq(
        field('name', $.identifier),
        ':=',
        field('value', $._expr),
      )),
      // name :: <A,B>? type TypeExpr
      prec(2, seq(
        field('name', $.identifier),
        '::',
        optional($.type_params),
        'type',
        field('type', $._expr),
      )),
      // name :: <A,B>? TypeExpr = expr
      prec(2, seq(
        field('name', $.identifier),
        '::',
        optional($.type_params),
        field('type', $._expr),
        '=',
        field('value', $._expr),
      )),
      // name :: <A,B>? TypeExpr { | clauses }
      prec(2, seq(
        field('name', $.identifier),
        '::',
        optional($.type_params),
        field('type', $._expr),
        field('body', $.func_block),
      )),
      // name pattern+ = expr  (simple function, no type sig)
      prec(1, seq(
        field('name', $.identifier),
        repeat1(field('param', $._pattern)),
        '=',
        field('body', $._expr),
      )),
    ),

    type_params: $ => seq('<', $.identifier, repeat(seq(',', $.identifier)), '>'),

    func_block: $ => seq('{', repeat($.clause), '}'),

    clause: $ => seq(
      '|',
      repeat1(field('param', $._pattern)),
      optional(field('guard', $.guard)),
      '=>',
      field('body', $._expr),
      ';',
    ),

    guard: $ => seq('if', $._expr),

    // ══════════════════════════════════════════════════════════════
    // Expressions
    // ══════════════════════════════════════════════════════════════

    // _atom_expr: expressions that cannot be the left side of application
    // without parentheses.  Restricting application to `_expr _atom_expr`
    // prevents the conflict explosion that `_expr _expr` would cause.
    _atom_expr: $ => choice(
      $.literal,
      $.atom,
      $.identifier,
      $.record,
      $.block,
      $.list,
      $.tuple,
      $.lambda,
      $.match_expr,
      $.if_expr,
      $.import_expr,
      $.type_form,
      seq('(', $._expr, ')'),
    ),

    _expr: $ => choice(
      $._atom_expr,
      $.application,
      $.binary_op,
      $.field_access,
      $.optional_chain,
      $.postfix_opt,
    ),

    // ─── Literals ────────────────────────────────────────────────

    literal: $ => choice($.bool, $.float, $.integer, $.string),

    bool: $ => choice('true', 'false'),

    // Float before integer: "1.5" must match float, not integer then dot.
    float: $ => token(seq(
      /[0-9]+/,
      '.',
      /[0-9]+/,
      optional(seq(/[eE]/, optional(/[+-]/), /[0-9]+/)),
    )),

    integer: $ => /[0-9]+/,

    string: $ => seq(
      '"',
      repeat(choice(
        token.immediate(/[^"\\]+/),
        $.escape_seq,
      )),
      '"',
    ),

    escape_seq: $ => token.immediate(seq('\\', /[^\r\n]/)),

    // ─── Atom literal ─────────────────────────────────────────────

    atom: $ => seq('#', token.immediate(/[A-Za-z_][A-Za-z0-9_-]*/)),

    // ─── Identifiers ──────────────────────────────────────────────

    // Standard identifier: no hyphens, used in expression context.
    identifier: $ => /[A-Za-z_][A-Za-z0-9_]*/,

    // Field identifier: allows hyphens, used only after `.` / `?.`.
    // Tree-sitter's context-based lexer ensures this is only attempted
    // when a field name is valid, so there is no conflict with identifier.
    field_identifier: $ => /[A-Za-z_][A-Za-z0-9_-]*/,

    // ─── Records ──────────────────────────────────────────────────

    record: $ => seq('{', repeat($.record_field), '}'),

    record_field: $ => seq(
      field('name', $.identifier),
      '=',
      field('value', $._expr),
      ';',
    ),

    // ─── Block expressions ────────────────────────────────────────

    // Block: one or more local bindings followed by a final expression.
    block: $ => seq('{', repeat1($.local_binding), $._expr, '}'),

    local_binding: $ => seq($.identifier, ':=', $._expr, ';'),

    // ─── Lists ────────────────────────────────────────────────────

    list: $ => seq('[', repeat($.list_item), ']'),

    list_item: $ => seq($._expr, ';'),

    // ─── Tuples ───────────────────────────────────────────────────

    // Unit () or 2+ comma-separated elements.
    tuple: $ => choice(
      seq('(', ')'),
      seq(
        '(',
        $._tuple_elem,
        ',',
        $._tuple_elem,
        repeat(seq(',', $._tuple_elem)),
        ')',
      ),
    ),

    _tuple_elem: $ => choice(
      seq($.identifier, '=', $._expr), // named: field = expr
      $._expr,                          // positional
    ),

    // ─── Lambda ───────────────────────────────────────────────────

    // \pattern+ . body
    lambda: $ => seq('\\', repeat1($._pattern), '.', $._expr),

    // ─── Match ────────────────────────────────────────────────────

    match_expr: $ => seq(
      'match',
      field('scrutinee', $._expr),
      '{',
      repeat($.match_arm),
      '}',
    ),

    match_arm: $ => seq(
      '|',
      field('pattern', $._pattern),
      optional(field('guard', $.guard)),
      '=>',
      field('body', $._expr),
      ';',
    ),

    // ─── If ───────────────────────────────────────────────────────

    if_expr: $ => seq(
      'if',
      field('condition', $._expr),
      'then',
      field('consequent', $._expr),
      'else',
      field('alternative', $._expr),
    ),

    // ─── Import ───────────────────────────────────────────────────

    import_expr: $ => seq('import', choice($.string, $.import_path)),

    // Unquoted path shorthand, e.g. config.zti
    import_path: $ => /[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*)*/,

    // ─── Type introduction ────────────────────────────────────────

    type_form: $ => seq('type', $._expr),

    // ─── Operators ────────────────────────────────────────────────

    // Precedence levels (lower number = lower precedence = binds looser):
    //  10  ->   (function type, right-assoc)
    //  20  |>   (pipeline fwd, left) / <|  (pipeline bwd, right)
    //  30  ??   (default, right)
    //  40  ||   (logical or, left)
    //  50  &&   (logical and, left)
    //  60  == != < <= > >=  (comparison, non-assoc)
    //  70  + -  (add/sub, left)
    //  80  * /  (mul/div, left)
    //  90  application  (left)
    // 100  field access / postfix ?  (highest)

    binary_op: $ => choice(
      prec.right(10,  seq($._expr, '->', $._expr)),
      prec.left(20,   seq($._expr, '|>', $._expr)),
      prec.right(20,  seq($._expr, '<|', $._expr)),
      prec.right(30,  seq($._expr, '??', $._expr)),
      prec.left(40,   seq($._expr, '||', $._expr)),
      prec.left(50,   seq($._expr, '&&', $._expr)),
      prec.left(60,   seq($._expr, choice('==', '!=', '<=', '>=', '<', '>'), $._expr)),
      prec.left(70,   seq($._expr, choice('+', '-'), $._expr)),
      prec.left(80,   seq($._expr, choice('*', '/'), $._expr)),
    ),

    // f x  (function application, left-assoc)
    application: $ => prec.left(90, seq($._expr, $._atom_expr)),

    // T?  (postfix optional type or optional value)
    postfix_opt: $ => prec(100, seq($._expr, '?')),

    // expr.field and expr?.field — field_identifier allows hyphens here
    field_access: $ => prec.left(100, seq($._expr, '.', $.field_identifier)),
    optional_chain: $ => prec.left(100, seq($._expr, '?.', $.field_identifier)),

    // ══════════════════════════════════════════════════════════════
    // Patterns
    // ══════════════════════════════════════════════════════════════

    _pattern: $ => choice(
      $.literal,
      $.atom,
      $.identifier,
      $.wildcard,
      $.tuple_pat,
      $.record_pat,
    ),

    // `_` alone as wildcard; prec(1) makes it win over identifier for `_`
    wildcard: $ => token(prec(1, '_')),

    tuple_pat: $ => choice(
      seq('(', ')'),
      seq(
        '(',
        $._pat_elem,
        ',',
        $._pat_elem,
        repeat(seq(',', $._pat_elem)),
        ')',
      ),
    ),

    _pat_elem: $ => choice(
      seq($.identifier, '=', $._pattern), // named: field = pattern
      $._pattern,                          // positional
    ),

    record_pat: $ => seq('{', repeat($.record_pat_field), '}'),

    record_pat_field: $ => seq($.identifier, '=', $._pattern, ';'),
  },
});

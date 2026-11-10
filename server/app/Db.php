<?php
declare(strict_types=1);

final class Db
{
    private static ?PDO $pdo = null;

    public static function pdo(): PDO
    {
        if (self::$pdo instanceof PDO) {
            return self::$pdo;
        }

        $host = Config::get('DB_HOST', 'localhost');
        $port = Config::int('DB_PORT', 3306);
        $name = Config::get('DB_NAME', '');
        $user = Config::get('DB_USER', '');
        $pass = Config::get('DB_PASS', '') ?? '';

        if ($name === '' || $user === '') {
            throw new RuntimeException('Banco nao configurado: preencha DB_NAME e DB_USER em server/.env');
        }

        $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $host, $port, $name);
        self::$pdo = new PDO($dsn, $user, $pass, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
        return self::$pdo;
    }

    /** @param array<string,mixed> $params */
    public static function run(string $sql, array $params = []): PDOStatement
    {
        $stmt = self::pdo()->prepare($sql);
        $stmt->execute($params);
        return $stmt;
    }

    /** @param array<string,mixed> $params */
    public static function all(string $sql, array $params = []): array
    {
        return self::run($sql, $params)->fetchAll();
    }

    /** @param array<string,mixed> $params */
    public static function one(string $sql, array $params = []): ?array
    {
        $row = self::run($sql, $params)->fetch();
        return $row === false ? null : $row;
    }

    /** @param array<string,mixed> $params */
    public static function value(string $sql, array $params = [], mixed $default = null): mixed
    {
        $value = self::run($sql, $params)->fetchColumn();
        return $value === false ? $default : $value;
    }

    public static function insert(string $sql, array $params = []): int
    {
        self::run($sql, $params);
        return (int) self::pdo()->lastInsertId();
    }

    /**
     * Executa uma transacao com retry automatico em caso de deadlock (SQLSTATE 40001).
     * O MySQL pode retornar deadlock quando uploads concorrentes disputam locks nas
     * tabelas models, loras e tags. Ate 5 tentativas com backoff + jitter aleatorio.
     */
    public static function transaction(callable $fn, int $maxRetries = 5): mixed
    {
        $attempt = 0;
        while (true) {
            $pdo = self::pdo();
            $pdo->beginTransaction();
            try {
                $result = $fn($pdo);
                $pdo->commit();
                return $result;
            } catch (PDOException $e) {
                if ($pdo->inTransaction()) {
                    $pdo->rollBack();
                }
                // SQLSTATE 40001 = Serialization failure (deadlock)
                $isDeadlock = $e->getCode() === '40001'
                    || str_contains($e->getMessage(), '1213 Deadlock');
                if ($isDeadlock && $attempt < $maxRetries - 1) {
                    $attempt++;
                    app_log('warn', 'Deadlock detectado, tentativa ' . ($attempt + 1) . '/' . $maxRetries, [
                        'sql_state' => $e->getCode(),
                    ]);
                    // backoff com jitter: 50-200ms, 100-400ms, ... evita reconexao em massa
                    usleep(random_int(50_000, 200_000) * $attempt);
                    continue;
                }
                throw $e;
            } catch (Throwable $e) {
                if ($pdo->inTransaction()) {
                    $pdo->rollBack();
                }
                throw $e;
            }
        }
    }
}

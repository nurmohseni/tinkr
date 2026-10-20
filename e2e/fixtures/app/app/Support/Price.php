<?php

namespace App\Support;

/** A class the completion popup can find and offer. */
class Price
{
    public static function withTax($amount, $rate = 0.2)
    {
        return round($amount * (1 + $rate), 2);
    }
}

const NextI18Next = require('next-i18next').default

const localeSubpaths = require('next/config').default().publicRuntimeConfig

const path = require ('path')


module.exports = new NextI18Next({

    defaultLanguage:'en',
    otherLanguage:['zhHant','fr','es'],
    localePath: path.resolve('./publuc/static/locales')



})

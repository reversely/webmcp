# Favor vendor survey (CA)

Rebuilt from products-ca.csv (600 rows), sellers-ca.csv (152 sellers), and card-categories-ca.csv by summarize.mts. Each row of queries.csv was one Global Catalog `search_catalog` call: 50 results, in stock, shipping to the run's address, shops located in the run's country, a price ceiling where the row has one. Nothing was hand-picked.

## Search types

| Type | Queries | Product rows | Distinct sellers | Rows with personalization words | Rows with dietary words |
| --- | --- | --- | --- | --- | --- |
| category | 3 | 150 | 62 | 17 | 0 |
| personalization | 5 | 250 | 87 | 120 | 0 |
| bulk | 1 | 50 | 32 | 16 | 0 |
| occasion | 2 | 100 | 49 | 25 | 0 |
| sentence | 1 | 50 | 22 | 26 | 0 |

## Queries, with the sellers each one returned

| Type | Query | Price ceiling | Rows | Sellers | Top sellers (products each) |
| --- | --- | --- | --- | --- | --- |
| category | thank you cards |  | 50 | 28 | Good Neighbour 9; The Cross Living (www.thecrossliving.com) 6; The Card Room at KRICKET’S  (thecardroom.ca) 4; Collected Joy (collected-joy.com) 2; Thistle & Wren (www.thistleandwren.com) 2 |
| category | stationery cards |  | 50 | 20 | Staples 12; Buchan's Kerrisdale Stationery (www.buchanst.com) 7; Lemon And Lavender Toronto (shop.lemonlavender.com) 4; Midoco Art & Office Supplies (midoco.ca) 3; Take Note Stationery Boutique (takenoteboutique.ca) 3 |
| category | note cards |  | 50 | 28 | Duly Noted Stationery (www.dulynoted.ca) 5; Take Note Stationery Boutique (takenoteboutique.ca) 4; Entershine Bookshop (www.entershinebookshop.ca) 4; Indigenous Collection and CAP & Winn Devon (www.indigenouscollection.com) 4; Front and Company: Gifts 3 |
| personalization | personalized thank you cards |  | 50 | 31 | Good Neighbour 6; The Cross Living (www.thecrossliving.com) 5; The Card Room at KRICKET’S  (thecardroom.ca) 5; Front and Company: Gifts 3; Red Pegasus (redpegasus.ca) 2 |
| personalization | personalized stationery |  | 50 | 19 | Dearest Nicky (dearestnicky.com) 7; Paper and Clips Co. 6; Written Word Calligraphy and Design 6; Smartly Empowered (www.smartlyempowered.com) 6; Something Personalized (somethingpersonalized.ca) 5 |
| personalization | custom thank you cards with name |  | 50 | 29 | The Friendly Paper Co. (thefriendlypaperco.com) 6; The Cross Living (www.thecrossliving.com) 6; Good Neighbour 5; The Card Room at KRICKET’S  (thecardroom.ca) 3; Ladd Stamps (laddstamps.com) 3 |
| personalization | monogrammed note cards |  | 50 | 26 | Lemon And Lavender Toronto (shop.lemonlavender.com) 15; Entershine Bookshop (www.entershinebookshop.ca) 4; Buchan's Kerrisdale Stationery (www.buchanst.com) 3; Outer Layer (outerlayer.com) 3; Take Note Stationery Boutique (takenoteboutique.ca) 3 |
| personalization | foil pressed thank you cards |  | 50 | 23 | Outer Layer (outerlayer.com) 9; Juxtapose Cards & Gifts 7; The Cross Living (www.thecrossliving.com) 6; Good Neighbour 4; Duly Noted Stationery (www.dulynoted.ca) 3 |
| bulk | thank you cards bulk 50 |  | 50 | 32 | Collected Joy (collected-joy.com) 7; The Cross Living (www.thecrossliving.com) 4; Indigo (www.indigo.ca) 4; Universal Church Supplies Inc (universalchurchsupplies.ca) 2; Joseph's (www.josephsinspirational.ca) 2 |
| occasion | corporate thank you cards |  | 50 | 27 | Good Neighbour 6; The Cross Living (www.thecrossliving.com) 5; Silla Designs (silladesigns.com) 3; The Card Room at KRICKET’S  (thecardroom.ca) 3; Wild Bloom Design Studio (wildbloomdesignstudio.com) 3 |
| occasion | event thank you notes for attendees |  | 50 | 33 | Go Print Plus (goprintplus.com) 4; Juxtapose Cards & Gifts 3; The Party Place (thepartyplace.ca) 3; Duly Noted Stationery (www.dulynoted.ca) 3; Banquet Atelier & Workshop LTD. (banquetworkshop.com) 2 |
| sentence | a personalized thank you card for each guest after the event |  | 50 | 22 | Go Print Plus (goprintplus.com) 21; Lauprint 4; Artisaire (artisaire.com) 3; The Cross Living (www.thecrossliving.com) 3; Templatables (www.templatables.com) 2 |

## Sellers

152 sellers; 152 answer the thirteen UCP tools; 149 carry the WebMCP loader.

| Seller | Search types | Products | With personalization words | UCP tools | Price min (cents) | Option names | Sample titles |
| --- | --- | --- | --- | --- | --- | --- | --- |
| The Cross Living (www.thecrossliving.com) | category; personalization; bulk; occasion; sentence | 37 | 6 | 13 | 995 | Quantity (1) | Hydrangea Thank You Card Boxed Set | Delft Thank You Card Boxed Set | Pink Hydrangea Thank You Card Boxed Set |
| Good Neighbour | category; personalization; bulk; occasion; sentence | 35 | 9 | 13 | 950 |  | Peacock Thank You Card (Boxed Set of 8) | Rosette Thank You Card | Seaside Thank You Card |
| The Card Room at KRICKET’S  (thecardroom.ca) | category; personalization; bulk; occasion; sentence | 19 | 6 | 13 | 895 |  | Rifle Paper Co - Thank You Roses Card | Doggy Thank You Card | Rifle Paper Co - Rose Garden Thank You Cards Boxed Set of |
| Juxtapose Cards & Gifts | category; personalization; bulk; occasion; sentence | 19 | 1 | 13 | 1595 |  | Garden Party Thank You Keepsake Boxed Cards | Garden Party Thank You Keepsake Boxed Cards | Lavender & Honey Thank You B |
| Collected Joy (collected-joy.com) | category; personalization; bulk; occasion; sentence | 16 | 12 | 13 | 750 |  | Rifle Thank You Bouquet | Japanese Design Thank you Card box of 16 | Rifle Thank You Bouquet |
| Red Pegasus (redpegasus.ca) | category; personalization; bulk; occasion; sentence | 9 | 7 | 13 | 2595 |  | Marimekko Kukka Notecards | Delphine Thank You Cards (Set of 8) | Thank You So Very Much Cards (Box Set) |
| Front and Company: Gifts | category; personalization; bulk; occasion | 13 | 0 | 13 | 895 | Packaging type (6), Pack size (1) | Pink Tulip Thank You Cards | Big Navy Striped Bow Thank You Note Greeting Card | Ladybugs Little Notes® |
| Indigo (www.indigo.ca) | category; personalization; bulk; occasion | 11 | 1 | 13 | 1080 | Format (2), Colour (1) | Watercolor Sunset Thank You Notes, Set Of 14 | Thank You Cards, Seriously Gold Foil, Set Of 20 | Lollipop Trees Boxed No |
| Seek and Bloom Creative Co. (seekandbloom.ca) | category; personalization; bulk; occasion | 9 | 0 | 13 | 1500 |  | Thank You, Pressed Flower Cosmos | Mixed Pack, Garden Inspired, Pressed Flower, Note Card Set | Star, Pressed Flower on  |
| Thistle & Wren (www.thistleandwren.com) | category; personalization; bulk; occasion | 8 | 0 | 13 | 915 |  | Strawberry Fields Thank You Card | Floral Thanks Card | Strawberry Fields Thank You Card |
| Scout (www.iheartscout.com) | category; personalization; bulk; occasion | 7 | 0 | 13 | 895 | Option (4) | Blue Gingham Thank You Card | Rosette Thank You Card | Blue Gingham Thank You Card |
| Go Print Plus (goprintplus.com) | personalization; occasion; sentence | 29 | 4 | 13 | 6200 | Flat or folded - by size (29), Paper type (29), Quantity (29) | Spring Pink Blossoms Thank You Card - Romantic Watercolor Florals | Pink Cross Thank You Card | Hand Drawn Wreath Thank  |
| Outer Layer (outerlayer.com) | category; personalization; occasion | 16 | 0 | 13 | 695 |  | Grateful Roses Friendship Greeting Card | Rose Garden Thank You Card | Tulips Pop Up Card |
| Duly Noted Stationery (www.dulynoted.ca) | category; personalization; occasion | 16 | 0 | 13 | 595 |  | Red Cap Cards Greeting Card - Thanks Fox | Writing Gift Set - Send With Love | E Frances Boxed Little Notes - Spot Of Te |
| Buchan's Kerrisdale Stationery (www.buchanst.com) | category; personalization; occasion | 15 | 0 | 13 | 1695 | Alphabet (1) | Peter Pauper Press - Boxed Note Cards - Poppies in Bloom | Peter Pauper Press - Owl Portrait Note Cards | PETER PAUPER P |
| Staples | category; bulk; occasion | 15 | 0 | 13 | 1699 | Variesby (15) | JAM Paper Recycled Parchment Stationery Set - 25 Cards and 25 A7 Envelopes - Natural - set of 25 | JAM Paper Stationery  |
| Take Note Stationery Boutique (takenoteboutique.ca) | category; personalization; occasion | 13 | 0 | 13 | 1500 |  | Boxed Notecards - Autumn Grasses | Boxed Premium Thank You - Eucalyptus | Boxed Notecards - Amethyst Butterflies |
| Entershine Bookshop (www.entershinebookshop.ca) | category; personalization; occasion | 11 | 0 | 13 | 1299 | Title (2) | Hummingbird Garden Note Cards | Lighthouse Note Cards | Blue Dragonflies Note Cards |
| Fort + Company  (fortandcompany.ca) | category; personalization; occasion | 7 | 4 | 13 | 1000 |  | With Gratitude Card | Delft Thank you Card | With Gratitude Card |
| Twentyseven (twentyseventoronto.com) | category; personalization; bulk | 6 | 1 | 13 | 3200 |  | Thanks Fox Thank You Greeting Card Box Set | Shadow Stationery Set | Calypso Stationery Set |
| 316 Publishing (316publishing.com) | category; personalization; bulk | 6 | 0 | 13 | 649 |  | Botanical Blessings Assorted Note Card Set - Set of 12 | Encouraging Truths Assorted Note Cards – Set of 12 | Bright Bir |
| Midoco Art & Office Supplies (midoco.ca) | category; personalization; occasion | 5 | 0 | 13 | 1499 |  | Cavallini Stationery Set - Wildflowers | Cavallini Stationery Set - Birds | Cavallini Stationery Set - Vintage Cats |
| Wordkind  (wordkind.ca) | category; personalization; occasion | 5 | 0 | 13 | 1299 |  | Gilded Butterflies Note Cards | Quill Pen and Ink Note Cards | Gilded Butterflies Note Cards |
| Halfpenny Postage (halfpennypostage.com) | category; personalization; bulk | 4 | 0 | 13 | 700 |  | Classic Thank You | Classic Thank You | Classic Thank You |
| Phidon Pens | category; personalization; bulk | 4 | 4 | 13 | 2095 |  | TUTTLE Thank You Cards Set - Cherry Blossoms | TUTTLE Thank You Cards Set - Cherry Blossoms | TUTTLE Thank You Cards Set |
| The Art of Home (www.theartofhome.ca) | category; bulk; occasion | 4 | 0 | 13 | 695 |  | Cherries Thank You Card by Rifle Paper Co. | Bunch of Roses Thank You Card | Prairie Garden Thank You Card by Rifle Pape |
| Cotton Willow Design Co. (www.cottonwillowdesign.com) | personalization; occasion; sentence | 4 | 4 | 13 | 300 | Color (2), Envelope addressing (2) | Modern Letterpress Personalized Stationery | Letterpress Personalized Stationery | Elegant Floral |
| Flowerhint (www.flowerhint.com) | personalization; bulk; sentence | 3 | 3 | 13 | 1754 |  | Personalized Blue Floral Funeral Thank You Cards with Envelopes, Custom Sympathy Bereavement Acknowledgement Notes with  |
| Exclusive Invites (exclusiveinvites.ca) | bulk; occasion; sentence | 3 | 0 | 13 | 1099 | Style (3) | Thank you Box Sets 50Pk | Thank You Box Sets 14 Card Set | Thank You Box Sets 14 Card Set |
| Lemon And Lavender Toronto (shop.lemonlavender.com) | category; personalization | 19 | 16 | 13 | 1299 |  | Tea Time Stationery Set - Cards & Stickers | Monogram Note Cards: I | Butterflies Stationery Set - Cards & Stickers |
| Dearest Nicky (dearestnicky.com) | category; personalization | 8 | 7 | 13 | 400 | Would you like envelopes? (7), Notepad style (7), Choose with or without envelopes (1) | Books and Tea Flat Note Cards - Set of 8 | Flower Filled Envelope Personalized Notepad - 30 sheets | Daisies Personalize |
| Artisaire (artisaire.com) | personalization; sentence | 7 | 5 | 13 | 310 | Paper (5), Color (3), Set (2) | Scribble Thank You Card | Design Your Own Thank You Card | Evelyn Foilpress Thank You Card |
| Silla Designs (silladesigns.com) | category; occasion | 5 | 0 | 13 | 899 |  | Hydrangea Thank You Card | Hydrangea Thank You Card | Gracie Thank You | Greeting Card |
| Paperly Shop (paperlyshop.com) | category; personalization | 4 | 4 | 13 | 6500 | Quantity (4), Corners (4) | Green Checkered Little Boy Set | Strawberry Gingham Stationery | Butterfly Toile Set |
| River Bookshop (riverbookshop.com) | category; personalization | 3 | 0 | 13 | 895 |  | Little Card Big Thanks | Little Card Big Thanks | Little Card Big Thanks |
| Ten Thousand Villages Abbotsford (bcvillages.ca) | category; personalization | 3 | 0 | 13 | 900 |  | Quilling Cards Vietnam - Thank You Quill & Ink | Quilling Cards Vietnam - Thank You Quill & Ink | Quilling Cards Vietnam |
| Wonder Pens (wonderpens.ca) | category; personalization | 3 | 0 | 13 | 825 |  | E. Frances Paper - Card - An Ocean of Thanks | E. Frances Paper - 55 Card Set - Whisky Business Little Notes | E. France |
| Universal Church Supplies Inc (universalchurchsupplies.ca) | category; bulk | 3 | 0 | 13 | 1299 |  | Boxed cards - THANK YOU - Box Of 12 | Boxed cards - THANK YOU - Box Of 12 | Boxed cards - THANK YOU - Box Of 12 |
| Mimi & August (mimiandaugust.com) | category; personalization | 3 | 3 | 13 | 699 |  | Floral Thank You Greeting Card | Floral Thank You Greeting Card | Floral Thank You Greeting Card |
| Tumbled Earth (tumbledearth.com) | category; personalization | 3 | 3 | 13 | 2400 |  | Allium Blossoms 14 Note Cards | Allium Blossoms 14 Note Cards | Allium Blossoms 14 Note Cards |
| The Botanist Calgary (www.thebotanistcalgary.com) | category; personalization | 3 | 0 | 13 | 1500 |  | Monarch Butterflies Note Cards | Butterflies Stationery Set | Monarch Butterflies Note Cards |
| Oleander Floral Design (oleander.ca) | category; personalization | 3 | 2 | 13 | 1500 | Design (2) | Boxed Blank Note Cards | Boxed Blank Note Cards | Premium Boxed Thank You Card Set |
| Cheerfetti Gift Co. (www.cheerfetti.ca) | personalization; occasion | 3 | 3 | 13 | 600 |  | Card - Thank you | Card - Thank you | Card - Thank you |
| Banquet Atelier & Workshop LTD. (banquetworkshop.com) | personalization; occasion | 3 | 0 | 13 | 600 |  | Hologram Foil Thank You Card | Thank You Nasturtiums Note Card | Ribbons Thank You  Note Card |
| Joseph's (www.josephsinspirational.ca) | personalization; bulk | 3 | 0 | 13 | 899 |  | Gold Foil Blank Thank You Cards (Box of 10) | Thank You Cards (Package of 50) | Gold Foil Blank Thank You Cards (Box of  |
| Presents Presents Presents (www.presentspresentspresents.ca) | category; personalization | 2 | 0 | 13 | 1695 |  | Note Cards- Watercolor Poppies | Note Cards- Floral Sympathy Thank You |
| QUEEN & GRACE (www.queenandgrace.com) | category; personalization | 2 | 1 | 13 | 4500 | Choose illustration (1), Quantity & price options (1), Quantity (1) | Illustrated Social Stationery | 45 Designs | Personalized Heart Stationery |
| Interior Couture (interiorcouture.ca) | category; occasion | 2 | 0 | 13 | 5000 |  | Gold Heart Letterpress Notecard Set | Pink Dot Thank You Note Set |
| Home Treasures & More (hometreasures.ca) | category; personalization | 2 | 0 | 13 | 1299 |  | Peter Pauper Press 'Tree of Butterflies' Note Cards | Peter Pauper Press 'Tree of Butterflies' Note Cards |
| Classy Cards Creative (classycards.ca) | category; personalization | 2 | 2 | 13 | 1200 |  | Love Notes - Bestie Collection | Love Notes - Bestie Collection |
| Whiskey2Water (whiskey2water.com) | personalization; bulk | 2 | 2 | 13 | 2500 | Quantity (2) | Thank You Cards | Thank You Cards |
| Mararamiro (www.mararamiro.com) | personalization; occasion | 2 | 1 | 13 | 1095 |  | Thank You No. 22 Letterpress Card | Thank You No. 01 Letterpress Card |
| Lumen Christi Books & Gifts (lumenchristibooks.ca) | bulk; sentence | 2 | 0 | 13 | 300 |  | Thank You Cards - One Design - Box of 50 | Thank You for Your Hospitality  Greeting Card by Legacy with Deluxe Envelope |
| Avenue de la personnalisation (avenuedelapersonnalisation.com) | occasion; sentence | 2 | 2 | 13 | 1700 | Carte (2) | CARTE DE REMERCIEMENT INVITÉ | CARTE DE REMERCIEMENT INVITÉ |

Every seller, including those one search type returned, is in sellers-ca.csv.

## Variant option names across every product row

| Option name | Rows |
| --- | --- |
| Quantity | 52 |
| Flat or folded - by size | 29 |
| Paper type | 29 |
| Variesby | 15 |
| Style | 9 |
| Color | 9 |
| Notepad style | 9 |
| Material | 8 |
| Would you like envelopes? | 7 |
| Packaging type | 6 |
| Size | 5 |
| Paper | 5 |
| Number of sets | 5 |
| Options | 5 |
| Corners | 4 |
| Design | 4 |
| Option | 4 |
| Printing method and color | 4 |
| Envelope color | 4 |
| Colour | 3 |
| Format | 3 |
| Little notes  | 2 |
| Title | 2 |
| Notecard style | 2 |
| Set | 2 |

## The four card categories against the catalog

| Card | Kind | Query | Filter value | Returned | Catalog total | Titles or messages |
| --- | --- | --- | --- | --- | --- | --- |
